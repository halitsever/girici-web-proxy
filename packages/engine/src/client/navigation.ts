import { encodeUrl, isReservedPath, PROXY_PREFIX } from "../shared/codec.ts";
import { rewriteJavascriptUrl } from "../shared/url-rewrite.ts";
import type { CookieBridge } from "./cookies.ts";
import type { Invoke } from "./invoke.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";

const LINK_EVENTS = ["click", "auxclick", "contextmenu"];

/** Navigations leave the service worker's reach, so their URLs are proxied before the browser acts on them. */
export function installNavigation(
  win: Realm,
  ctx: UrlContext,
  cookies: CookieBridge,
  invoke: Invoke,
): DocumentListeners {
  const history = win.History.prototype;
  for (const method of ["pushState", "replaceState"] as const) {
    const native = history[method];
    history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      if (url === undefined || url === null) return native.call(this, data, unused, url);
      const current = ctx.realUrl();
      const target = new URL(String(url), current);
      if (target.origin !== current.origin) {
        throw new win.DOMException(
          `A history state with URL '${target.href}' cannot be created in a document with origin '${current.origin}'.`,
          "SecurityError",
        );
      }
      return native.call(this, data, unused, encodeUrl(target));
    };
  }

  const nativeOpen = win.open;
  win.open = function (this: Window | undefined, url?: string | URL, target?: string, features?: string) {
    const proxied = url === undefined || url === null || url === "" ? url : ctx.toProxy(String(url));
    return nativeOpen.call(this ?? win, proxied, target, features);
  };

  // The Navigation API leaves the service worker's reach like any navigation, so its target is proxied first.
  const navigation = (win as unknown as { navigation?: { navigate?: (url: string, options?: unknown) => unknown } })
    .navigation;
  if (navigation && typeof navigation.navigate === "function") {
    const nativeNavigate = navigation.navigate.bind(navigation);
    navigation.navigate = (url: string, options?: unknown) => nativeNavigate(ctx.toProxy(String(url)), options);
  }

  // Links and forms that slipped past rewriting are fixed just before the browser follows them.
  const fix = (element: Element, name: string) => {
    const attribute = element.getAttributeNode(name);
    if (attribute && escapes(attribute.value, ctx)) attribute.value = ctx.toProxy(attribute.value);
  };
  const listeners: Array<[string, (event: Event) => void, boolean]> = [];
  const fixLink = (event: Event) => {
    for (const target of event.composedPath()) {
      if (target instanceof win.HTMLAnchorElement || target instanceof win.HTMLAreaElement) {
        fix(target, "href");
        return;
      }
      if (target instanceof win.SVGAElement) {
        fix(target, "href");
        fix(target, "xlink:href");
        return;
      }
    }
  };
  for (const type of LINK_EVENTS) listeners.push([type, fixLink, true]);
  listeners.push([
    "submit",
    (event) => {
      if (event.target instanceof win.HTMLFormElement) fix(event.target, "action");
      const submitter = (event as SubmitEvent).submitter;
      if (submitter) fix(submitter, "formaction");
    },
    true,
  ]);

  const form = win.HTMLFormElement.prototype;
  const { submit, requestSubmit } = form;
  form.submit = function (this: HTMLFormElement) {
    fix(this, "action");
    submit.call(this);
  };
  form.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
    fix(this, "action");
    if (submitter) fix(submitter, "formaction");
    requestSubmit.call(this, submitter);
  };

  // These run after the page's own handlers, so links and forms a page handles itself are left alone.
  listeners.push([
    "click",
    (event) => {
      const writes = cookies.pendingWrites();
      if (!writes || event.defaultPrevented || !isPlainClick(event)) return;
      const link = event
        .composedPath()
        .find((target) => target instanceof win.HTMLAnchorElement || target instanceof win.HTMLAreaElement);
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = resolve(link.getAttributeNode("href")?.value, ctx);
      if (!url) return;
      event.preventDefault();
      // The next page must already see cookies this one has just written.
      void writes.then(() => invoke(win.location.assign, win.location, [url]));
    },
    false,
  ]);
  listeners.push([
    "submit",
    (event) => {
      const writes = cookies.pendingWrites();
      const target = event.target;
      if (!writes || event.defaultPrevented || !(target instanceof win.HTMLFormElement)) return;
      const submitter = (event as SubmitEvent).submitter;
      if ((target.target && target.target !== "_self") || overridesForm(submitter)) return;
      event.preventDefault();
      void writes.then(() => {
        const extra = submitterField(win, submitter);
        if (extra) target.append(extra);
        fix(target, "action");
        submit.call(target);
        extra?.remove();
      });
    },
    false,
  ]);

  const addListener = win.addEventListener.bind(win);
  const listen = () => {
    for (const [type, listener, capture] of listeners) addListener(type, listener, capture);
  };
  listen();
  return { listen };
}

function isPlainClick(event: Event): boolean {
  return (
    event instanceof MouseEvent &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function resolve(raw: string | undefined, ctx: UrlContext): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, new URL(encodeUrl(ctx.realBase()), ctx.origin));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A submitter that redirects the form elsewhere is left to the browser rather than replayed without its overrides. */
function overridesForm(submitter: HTMLElement | null): boolean {
  return (
    !!submitter &&
    ["formaction", "formmethod", "formenctype", "formtarget"].some((name) => submitter.hasAttribute(name))
  );
}

/** form.submit() leaves out the clicked button, so its name and value travel in a hidden field instead. */
function submitterField(win: Realm, submitter: HTMLElement | null): HTMLInputElement | null {
  const name = submitter?.getAttribute("name");
  if (!submitter || !name) return null;
  const field = win.document.createElement("input");
  field.type = "hidden";
  field.name = name;
  field.value = (submitter as HTMLButtonElement).value;
  return field;
}

function escapes(raw: string, ctx: UrlContext): boolean {
  const script = rewriteJavascriptUrl(raw);
  if (script !== null) return script !== raw;
  let url: URL;
  try {
    url = new URL(raw, new URL(encodeUrl(ctx.realBase()), ctx.origin));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.origin !== ctx.origin) return true;
  return !url.pathname.startsWith(PROXY_PREFIX) && !isReservedPath(url.pathname);
}
