import { encodeUrl, isReservedPath, PROXY_PREFIX } from "../shared/codec.ts";
import { apply, hrefOf, isWebUrl, newUrl, originOf, pathnameOf, startsWith, toText } from "../shared/primordials.ts";
import { rewriteJavascriptUrl } from "../shared/url-rewrite.ts";
import type { CookieBridge } from "./cookies.ts";
import type { Invoke } from "./invoke.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { openedOrigin, type WindowGuard } from "./windows.ts";

const LINK_EVENTS = ["click", "auxclick", "contextmenu"];

// Taken at load: these hooks run on page calls, after page code may have replaced them.
const ownDescriptor = Object.getOwnPropertyDescriptor;

/** Navigations leave the service worker's reach, so their URLs are proxied before the browser acts on them. */
export function installNavigation(
  win: Realm,
  ctx: UrlContext,
  cookies: CookieBridge,
  invoke: Invoke,
  guard: WindowGuard,
): DocumentListeners {
  const history = win.History.prototype;
  const historyOf = ownDescriptor(win, "history")?.get;
  for (const method of ["pushState", "replaceState"] as const) {
    const native = history[method];
    history[method] = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
      // Another window's History would let a frame rename a page it cannot otherwise touch.
      if (historyOf && this !== apply(historyOf, win, [])) {
        throw new win.DOMException(`Failed to execute '${method}' on 'History': access denied.`, "SecurityError");
      }
      if (url === undefined || url === null) return apply(native, this, [data, unused, url]);
      const current = ctx.realUrl();
      const target = newUrl(toText(url), current);
      if (originOf(target) !== originOf(current)) {
        throw new win.DOMException(
          `A history state with URL '${hrefOf(target)}' cannot be created in a document with origin '${originOf(current)}'.`,
          "SecurityError",
        );
      }
      return apply(native, this, [data, unused, encodeUrl(target)]);
    };
  }

  const nativeOpen = win.open;
  win.open = function (this: Window | undefined, url?: string | URL, target?: string, features?: string) {
    const proxied = url === undefined || url === null || url === "" ? url : ctx.toProxy(toText(url));
    const opened: unknown = apply(nativeOpen, this ?? win, [proxied, target, features]);
    // Until the page it was opened for arrives, a popup shows a blank page of this origin.
    return guard.wrap(opened, openedOrigin(proxied, ctx.origin)) as Window | null;
  };

  // The Navigation API leaves the service worker's reach like any navigation, so its target is proxied first.
  const navigation = (win as unknown as { navigation?: { navigate?: (url: string, options?: unknown) => unknown } })
    .navigation;
  if (navigation && typeof navigation.navigate === "function") {
    const nativeNavigate = navigation.navigate.bind(navigation);
    navigation.navigate = (url: string, options?: unknown) => nativeNavigate(ctx.toProxy(toText(url)), options);
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
    apply(submit, this, []);
  };
  form.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
    fix(this, "action");
    if (submitter) fix(submitter, "formaction");
    apply(requestSubmit, this, [submitter]);
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
        apply(submit, target, []);
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
    const url = newUrl(raw, newUrl(encodeUrl(ctx.realBase()), ctx.origin));
    return isWebUrl(url) ? hrefOf(url) : null;
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
    url = newUrl(raw, newUrl(encodeUrl(ctx.realBase()), ctx.origin));
  } catch {
    return false;
  }
  if (!isWebUrl(url)) return false;
  if (originOf(url) !== ctx.origin) return true;
  const pathname = pathnameOf(url);
  return !startsWith(pathname, PROXY_PREFIX) && !isReservedPath(pathname);
}
