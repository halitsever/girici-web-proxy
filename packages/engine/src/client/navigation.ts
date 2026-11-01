import { encodeUrl, isReservedPath, PROXY_PREFIX } from "../shared/codec.ts";
import {
  append,
  apply,
  define,
  hrefOf,
  isWebUrl,
  listIncludes,
  newUrl,
  originOf,
  pathnameOf,
  promiseThen,
  startsWith,
  toText,
} from "../shared/primordials.ts";
import { rewriteJavascriptUrl } from "../shared/url-rewrite.ts";
import type { BlobDocuments } from "./blob-documents.ts";
import type { CookieBridge } from "./cookies.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { openedOrigin, type WindowGuard } from "./windows.ts";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LINK_EVENTS = ["click", "auxclick", "contextmenu", "dragstart"];
/** A context menu or drag reads the link after these end, so its blob swap lasts until the next interaction. */
const LATER_EVENTS = ["contextmenu", "dragstart"];
const INTERACTIONS = ["pointerdown", "keydown", "dragend"];
const FORM_OVERRIDES = ["formaction", "formmethod", "formenctype", "formtarget"];

// Taken at load: these hooks run on page calls, after page code may have replaced them.
const ownDescriptor = Object.getOwnPropertyDescriptor;

export interface NavigationHooks extends DocumentListeners {
  /** The hooked window.open, which owns proxying, the blob swap and the guard for every window opened by URL. */
  open: (this: unknown, ...args: unknown[]) => unknown;
}

/** Navigations leave the service worker's reach, so their URLs are proxied before the browser acts on them. */
export function installNavigation(
  win: Realm,
  ctx: UrlContext,
  cookies: CookieBridge,
  invoke: Invoke,
  guard: WindowGuard,
  blobs: Pick<BlobDocuments, "swap" | "swapLink" | "restoreLinks" | "swapForm">,
): NavigationHooks {
  const history = win.History.prototype;
  const historyOf = ownDescriptor(win, "history")?.get;
  // Every loop here is indexed: adopting a frame installs this inside a page call, after the page may have replaced
  // the array iterator.
  const historyMethods = ["pushState", "replaceState"] as const;
  for (let index = 0; index < historyMethods.length; index++) {
    const method = historyMethods[index] as (typeof historyMethods)[number];
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
      return apply(native, this, [data, unused, ctx.documentAddress(target)]);
    };
  }

  const nativeOpen = win.open;
  const hookedOpen = maskNative(function (this: unknown, url?: unknown, target?: unknown, features?: unknown) {
    const proxied = url === undefined || url === null || url === "" ? url : blobs.swap(ctx.toProxy(toText(url)));
    const opened: unknown = apply(nativeOpen, this ?? win, [proxied, target, features]);
    // Until the page it was opened for arrives, a popup shows a blank page of this origin.
    return guard.wrap(opened, openedOrigin(proxied, ctx.origin)) as Window | null;
  }, nativeOpen);
  win.open = hookedOpen as typeof win.open;

  // The Navigation API leaves the service worker's reach like any navigation, so its target is proxied first. The
  // prototype is hooked, since a page can call its method on the instance directly.
  const navigationProto = (win as unknown as { Navigation?: { prototype: object } }).Navigation?.prototype;
  const navigateDescriptor = navigationProto && ownDescriptor(navigationProto, "navigate");
  const nativeNavigate = navigateDescriptor?.value as ((...args: unknown[]) => unknown) | undefined;
  if (navigationProto && navigateDescriptor && typeof nativeNavigate === "function") {
    define(navigationProto, "navigate", {
      ...navigateDescriptor,
      value: maskNative(function (this: unknown, url: unknown, options?: unknown) {
        return apply(nativeNavigate, this, [blobs.swap(ctx.toProxy(toText(url))), options]);
      }, nativeNavigate),
    });
  }

  // Taken here, since the listeners below decide on every user click and submit after page code has run. Frames
  // adopted from a parent run this code too, so nothing below may test values with this realm's own classes.
  const elementProto = win.Element.prototype;
  const { getAttributeNode, getAttribute, hasAttribute } = elementProto;
  const localNameOf = ownDescriptor(elementProto, "localName")?.get;
  const namespaceOf = ownDescriptor(elementProto, "namespaceURI")?.get;
  const attrValue = win.Attr ? ownDescriptor(win.Attr.prototype, "value") : undefined;
  const eventProto = win.Event?.prototype;
  const composedPathOf = eventProto?.composedPath;
  const eventGetter = (name: string) => (eventProto ? ownDescriptor(eventProto, name)?.get : undefined);
  const typeOf = eventGetter("type");
  const targetOf = eventGetter("target");
  const preventedOf = eventGetter("defaultPrevented");
  const preventDefault = eventProto?.preventDefault;
  const submitterOf = win.SubmitEvent ? ownDescriptor(win.SubmitEvent.prototype, "submitter")?.get : undefined;
  const plainClick = clickCheck(win);
  const read = (get: (() => unknown) | undefined, object: unknown, key: string): unknown =>
    get ? apply(get, object, []) : (object as Record<string, unknown>)[key];
  const kindOf = (target: unknown): "link" | "svg link" | "form" | null => {
    try {
      const name = read(localNameOf, target, "localName");
      const namespace = read(namespaceOf, target, "namespaceURI");
      if (namespace === SVG_NAMESPACE) return name === "a" ? "svg link" : null;
      if (namespace !== HTML_NAMESPACE) return null;
      return name === "a" || name === "area" ? "link" : name === "form" ? "form" : null;
    } catch {
      return null;
    }
  };
  const pathOf = (event: Event): unknown[] => {
    try {
      return (composedPathOf ? apply(composedPathOf, event, []) : event.composedPath()) as unknown[];
    } catch {
      return [];
    }
  };
  const attributeOf = (element: unknown, name: string): string | null =>
    apply(getAttribute, element, [name]) as string | null;

  // Links and forms that slipped past rewriting are fixed just before the browser follows them.
  const fix = (element: unknown, name: string) => {
    const attribute = apply(getAttributeNode, element, [name]) as Attr | null;
    if (!attribute) return;
    const value = toText(read(attrValue?.get, attribute, "value"));
    if (!escapes(value, ctx)) return;
    if (attrValue?.set) apply(attrValue.set, attribute, [ctx.toProxy(value)]);
    else attribute.value = ctx.toProxy(value);
  };
  const listeners: Array<[string, (event: Event) => void, boolean]> = [];
  const fixLink = (event: Event) => {
    const path = pathOf(event);
    for (let index = 0; index < path.length; index++) {
      const target = path[index];
      const kind = kindOf(target);
      if (kind !== "link" && kind !== "svg link") continue;
      fix(target, "href");
      if (kind === "svg link") fix(target, "xlink:href");
      blobs.swapLink(target, listIncludes(LATER_EVENTS, read(typeOf, event, "type") as string));
      return;
    }
  };
  for (let index = 0; index < LINK_EVENTS.length; index++)
    append(listeners, [LINK_EVENTS[index] as string, fixLink, true]);
  for (let index = 0; index < INTERACTIONS.length; index++) {
    append(listeners, [INTERACTIONS[index] as string, () => blobs.restoreLinks(), true]);
  }
  append(listeners, [
    "submit",
    (event) => {
      const submitter = read(submitterOf, event, "submitter") as HTMLElement | null;
      const target = read(targetOf, event, "target");
      if (kindOf(target) === "form") {
        fix(target, "action");
        blobs.swapForm(target, submitter);
      }
      if (submitter) fix(submitter, "formaction");
    },
    true,
  ]);

  const form = win.HTMLFormElement.prototype;
  const { submit, requestSubmit } = form;
  form.submit = function (this: HTMLFormElement) {
    fix(this, "action");
    blobs.swapForm(this);
    apply(submit, this, []);
  };
  form.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
    fix(this, "action");
    if (submitter) fix(submitter, "formaction");
    apply(requestSubmit, this, [submitter]);
  };

  // These run after the page's own handlers, so links and forms a page handles itself are left alone.
  append(listeners, [
    "click",
    (event) => {
      const writes = cookies.pendingWrites();
      if (!writes || read(preventedOf, event, "defaultPrevented") || !plainClick(event)) return;
      const path = pathOf(event);
      let link: unknown = null;
      for (let index = 0; index < path.length && !link; index++) if (kindOf(path[index]) === "link") link = path[index];
      if (!link) return;
      const target = attributeOf(link, "target");
      if ((target && target !== "_self") || apply(hasAttribute, link, ["download"])) return;
      const attribute = apply(getAttributeNode, link, ["href"]) as Attr | null;
      const url = resolve(attribute ? toText(read(attrValue?.get, attribute, "value")) : undefined, ctx);
      if (!url) return;
      if (preventDefault) apply(preventDefault, event, []);
      else event.preventDefault();
      // The next page must already see cookies this one has just written. The hooked Attr value is the real URL.
      void promiseThen(writes, () => invoke(win.location.assign, win.location, [addressOf(url, ctx)]));
    },
    false,
  ]);
  append(listeners, [
    "submit",
    (event) => {
      const writes = cookies.pendingWrites();
      const target = read(targetOf, event, "target") as HTMLFormElement;
      if (!writes || read(preventedOf, event, "defaultPrevented") || kindOf(target) !== "form") return;
      const submitter = read(submitterOf, event, "submitter") as HTMLElement | null;
      const formTarget = attributeOf(target, "target");
      if ((formTarget && formTarget !== "_self") || overridesForm(submitter, hasAttribute)) return;
      if (preventDefault) apply(preventDefault, event, []);
      else event.preventDefault();
      void promiseThen(writes, () => {
        const extra = submitterField(win, submitter);
        if (extra) target.append(extra);
        fix(target, "action");
        blobs.swapForm(target);
        apply(submit, target, []);
        extra?.remove();
      });
    },
    false,
  ]);

  const addListener = win.addEventListener;
  // Runs again after document.open, inside a page call, so it reads the list by index.
  const listen = () => {
    for (let index = 0; index < listeners.length; index++) {
      const entry = listeners[index] as [string, (event: Event) => void, boolean];
      apply(addListener, win, [entry[0], entry[1], entry[2]]);
    }
  };
  listen();
  return { listen, open: hookedOpen };
}

/**
 * A primary click with no modifier keys. MouseEvent's own getters throw for anything else, so the check holds for
 * events of an adopted frame too, where this realm's MouseEvent is not theirs.
 */
function clickCheck(win: Realm): (event: unknown) => boolean {
  const proto = win.MouseEvent?.prototype;
  const getter = (name: string) => (proto ? ownDescriptor(proto, name)?.get : undefined);
  const button = getter("button");
  const keys = [getter("metaKey"), getter("ctrlKey"), getter("shiftKey"), getter("altKey")];
  return (event) => {
    if (!button) return false;
    try {
      if (apply(button, event, []) !== 0) return false;
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        if (key && apply(key, event, [])) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
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

/** The address a link this window follows loads at, sealed for its own origin while the page holds a seal. */
function addressOf(url: string, ctx: UrlContext): string {
  const real = newUrl(ctx.fromProxy(url));
  return originOf(real) === ctx.origin ? ctx.toProxy(url) : ctx.documentAddress(real);
}

/** A submitter that redirects the form elsewhere is left to the browser rather than replayed without its overrides. */
function overridesForm(submitter: HTMLElement | null, hasAttribute: Element["hasAttribute"]): boolean {
  if (!submitter) return false;
  // Indexed, with the window's own hasAttribute: this runs on the page's submits.
  for (let index = 0; index < FORM_OVERRIDES.length; index++) {
    if (apply(hasAttribute, submitter, [FORM_OVERRIDES[index]])) return true;
  }
  return false;
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
  const script = rewriteJavascriptUrl(raw, originOf(ctx.realUrl()));
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
