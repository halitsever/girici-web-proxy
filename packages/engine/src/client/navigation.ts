import { encodeUrl, isReservedPath, PROXY_PREFIX } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";

const LINK_EVENTS = ["click", "auxclick", "contextmenu"];

/** Navigations leave the service worker's reach, so their URLs are proxied before the browser acts on them. */
export function installNavigation(win: Realm, ctx: UrlContext): void {
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

  // Links and forms that slipped past rewriting are fixed just before the browser follows them.
  const fix = (element: Element, name: string) => {
    const attribute = element.getAttributeNode(name);
    if (attribute && escapes(attribute.value, ctx)) attribute.value = ctx.toProxy(attribute.value);
  };
  for (const type of LINK_EVENTS) {
    win.addEventListener(
      type,
      (event) => {
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
      },
      true,
    );
  }
  win.addEventListener(
    "submit",
    (event) => {
      if (event.target instanceof win.HTMLFormElement) fix(event.target, "action");
      const submitter = (event as SubmitEvent).submitter;
      if (submitter) fix(submitter, "formaction");
    },
    true,
  );

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
}

function escapes(raw: string, ctx: UrlContext): boolean {
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
