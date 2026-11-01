import type { AssignHref, Invoke } from "./invoke.ts";
import { post } from "./messaging.ts";
import { maskNative } from "./native-mask.ts";
import type { CrossSitePost } from "./site-messages.ts";
import { encodeUrl } from "../shared/codec.ts";
import {
  apply,
  define,
  exec,
  hrefOf,
  lowerCase,
  NativeWeakMap,
  NativeWeakSet,
  newUrl,
  originOf,
  parseUrl,
  pathnameOf,
  sliceOf,
  toNumber,
  toText,
} from "../shared/primordials.ts";
import { isSealedPath } from "../shared/sealed-address.ts";
import { rewriteJavascriptUrl } from "../shared/url-rewrite.ts";
import { realOriginOf, realUrlOf, type Realm, type UrlContext } from "./url-context.ts";

export { realOriginOf };

/** Hands out windows of another real origin only as restricted wrappers, the way browsers treat cross-origin windows. */
export interface WindowGuard {
  /** `headedTo` is the real origin a window is about to load, such as a popup just opened with a URL. */
  wrap(value: unknown, headedTo?: string): unknown;
  isWrapper(value: unknown): boolean;
  /** A new document in this window starts with no window handed out as is. */
  reset(): void;
}

// Taken at load: wrappers run inside page calls, after page code may have replaced any of these.
const reflectGet = Reflect.get;
const reflectSet = Reflect.set;
const reflectHas = Reflect.has;
const reflectOwnKeys = Reflect.ownKeys;
const reflectDefine = Reflect.defineProperty;
const reflectDelete = Reflect.deleteProperty;
const reflectProto = Reflect.getPrototypeOf;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const create = Object.create;
const NativeProxy = Proxy;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;
const setHas = WeakSet.prototype.has;
const setAdd = WeakSet.prototype.add;
const hasOwn = Object.prototype.hasOwnProperty;

/** Fixed own properties the engine puts on a window it opens, which the engine of every realm reads. */
export const WINDOW_MADE = "__g$made";
/** The real origin a blank window was sent to: until that page arrives, every realm keeps it locked. */
export const WINDOW_BOUND = "__g$to";

/** Non-configurable, so no page takes it off again; a window that already has the key keeps its first value. */
export function markWindow(target: unknown, key: string, value: string): boolean {
  try {
    return reflectDefine(target as object, key, {
      __proto__: null,
      value,
      writable: false,
      enumerable: false,
      configurable: false,
    } as PropertyDescriptor);
  } catch {
    return false;
  }
}

/** A mark's value, read as an own data property only. */
export function windowMark(target: unknown, key: string): unknown {
  try {
    const descriptor = ownDescriptor(target, key);
    return descriptor && apply(hasOwn, descriptor, ["value"]) ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** The cross-origin members browsers expose. A null prototype keeps page additions to Object.prototype out of `in`. */
const CROSS_ORIGIN_KEYS: Record<string, true> = Object.assign(Object.create(null) as Record<string, true>, {
  postMessage: true,
  close: true,
  closed: true,
  focus: true,
  blur: true,
  location: true,
  length: true,
  window: true,
  self: true,
  frames: true,
  top: true,
  parent: true,
  opener: true,
});

/**
 * The real origin a window opened with the proxied URL `proxied` is headed to, or undefined for a blank one. A
 * relative URL the rewriter left as it was resolves against the document's base, `base`, as the browser resolves it.
 */
export function openedOrigin(proxied: unknown, origin: string, base?: URL): string | undefined {
  if (proxied === undefined || proxied === null || proxied === "") return undefined;
  const address = parseUrl(toText(proxied), proxyBase(origin, base));
  const destination = address ? realUrlOf(hrefOf(address), origin) : null;
  return destination ? originOf(destination) : undefined;
}

function proxyBase(origin: string, base: URL | undefined): string {
  if (!base) return origin;
  try {
    return hrefOf(newUrl(encodeUrl(base), origin));
  } catch {
    // A base that is no web address resolves nothing the proxy serves.
    return origin;
  }
}

const INTEGER = /^[+-]?[0-9]+/;

/** Whether window features ask for noopener, read with the HTML standard's tokenizer and boolean feature rules. */
export function seversOpener(features: string): boolean {
  const tokens = featureTokens(features);
  return isFeatureSet(tokens, "noopener") || isFeatureSet(tokens, "noreferrer");
}

function isSeparator(char: string): boolean {
  return (
    char === "=" || char === "," || char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r"
  );
}

function featureTokens(features: string): Record<string, string> {
  const tokens = { __proto__: null } as unknown as Record<string, string>;
  const at = (index: number) => sliceOf(features, index, index + 1);
  const end = features.length;
  let position = 0;
  while (position < end) {
    while (position < end && isSeparator(at(position))) position++;
    const nameStart = position;
    while (position < end && !isSeparator(at(position))) position++;
    const name = lowerCase(sliceOf(features, nameStart, position));
    while (position < end && at(position) !== "=") {
      if (at(position) === "," || !isSeparator(at(position))) break;
      position++;
    }
    let value = "";
    if (position < end && isSeparator(at(position))) {
      while (position < end && isSeparator(at(position)) && at(position) !== ",") position++;
      const valueStart = position;
      while (position < end && !isSeparator(at(position))) position++;
      value = lowerCase(sliceOf(features, valueStart, position));
    }
    if (name !== "") tokens[name] = value;
  }
  return tokens;
}

function isFeatureSet(tokens: Record<string, string>, name: string): boolean {
  if (!apply(hasOwn, tokens, [name])) return false;
  const value = tokens[name] as string;
  if (value === "" || value === "yes" || value === "true") return true;
  const parsed = exec(INTEGER, value);
  return parsed !== null && toNumber(parsed[0]) !== 0;
}

function isWindow(value: unknown): value is object {
  try {
    return typeof value === "object" && value !== null && (value as { window?: unknown }).window === value;
  } catch {
    return false;
  }
}

function isIndex(property: string): boolean {
  const index = +property;
  return `${index}` === property && index >= 0 && index % 1 === 0;
}

export function createWindowGuard(
  win: Realm,
  ctx: UrlContext,
  invoke: Invoke,
  swapBlob: (url: string) => string = (url) => url,
  assignHref?: AssignHref,
  crossSite?: CrossSitePost,
): WindowGuard {
  // Taken before the messaging and window hooks replace them; window members are own properties of each window.
  const DOMException = win.DOMException;
  const nativePost = win.postMessage;
  const methods = { close: win.close, focus: win.focus, blur: win.blur };
  const getter = (name: string) => ownDescriptor(win, name)?.get;
  const getters = {
    closed: getter("closed"),
    length: getter("length"),
    top: getter("top"),
    parent: getter("parent"),
    opener: getter("opener"),
  };
  const frameElementOf = getter("frameElement");
  const getAttribute = win.Element?.prototype.getAttribute;

  const selfOrigin = () => originOf(ctx.realUrl());
  const addressOrigin = (target: object): string | null => {
    try {
      const href = (target as { location: { href: string } }).location.href;
      const real = realUrlOf(href, ctx.origin, ctx.openSealed);
      if (real) return originOf(real);
      const address = parseUrl(href);
      // Another origin's sealed address: only that page's runtime, once it holds the page's seal, can name it.
      if (address && originOf(address) === ctx.origin && isSealedPath(pathnameOf(address))) {
        return realOriginOf(target, ctx.origin);
      }
      return null;
    } catch {
      return null;
    }
  };
  const sameOrigin = (target: object) => realOriginOf(target, ctx.origin, ctx.openSealed) === selfOrigin();
  const deny = (): never => {
    throw new DOMException(
      `Blocked a frame with origin "${selfOrigin()}" from accessing a cross-origin frame.`,
      "SecurityError",
    );
  };

  let given = new NativeWeakSet<object>();
  const wrappers = new NativeWeakMap<object, object>();
  const isWrapper = (value: unknown): boolean =>
    typeof value === "object" && value !== null && apply(setHas, ownWrappers, [value]);
  const ownWrappers = new NativeWeakSet<object>();

  /** Another tab can move to another site while page code still holds it, so it never goes out as is. */
  const isOtherTab = (value: object): boolean =>
    value !== win && read(value, "parent") === value && value !== read(win, "top");

  /** A blank frame whose element names another origin's page, which will arrive in this very window. */
  const frameHeading = (value: object): string | undefined => {
    try {
      if (!frameElementOf || !getAttribute) return undefined;
      if ((value as { location: { href: string } }).location.href !== "about:blank") return undefined;
      const element = apply(frameElementOf, value, []) as Element | null;
      if (!element || apply(getAttribute, element, ["srcdoc"]) !== null) return undefined;
      return openedOrigin(apply(getAttribute, element, ["src"]), ctx.origin, ctx.realBase());
    } catch {
      return undefined;
    }
  };

  const wrap = (value: unknown, headedTo?: string): unknown => {
    if (!isWindow(value) || isWrapper(value) || apply(setHas, given, [value])) return value;
    const cached = apply(mapGet, wrappers, [value]) as object | undefined;
    if (cached) return cached;
    if (headedTo === undefined && value !== win) {
      // Another realm's engine may have sent this blank window to another site; its mark locks it here too.
      const bound = windowMark(value, WINDOW_BOUND);
      headedTo = typeof bound === "string" ? bound : frameHeading(value);
    }
    // A frame handed out as is stays so: whoever got it keeps it anyway, and one window must stay one object.
    if (sameOrigin(value) && (headedTo === undefined || headedTo === selfOrigin()) && !isOtherTab(value)) {
      apply(setAdd, given, [value]);
      return value;
    }
    const wrapper = restrict(value, headedTo !== undefined && headedTo !== selfOrigin());
    apply(mapSet, wrappers, [value, wrapper]);
    apply(setAdd, ownWrappers, [wrapper]);
    return wrapper;
  };

  /** Never falls back to a property read on a real window: its page could redefine it to hand over its own objects. */
  const read = (target: object, name: keyof typeof getters): unknown => {
    const get = getters[name];
    try {
      return get ? apply(get, target, []) : null;
    } catch {
      return null;
    }
  };

  const navigate = (target: object, url: unknown, replace: boolean) => {
    const text = toText(url);
    // Code for another site's window is dropped, as a browser drops a cross-origin javascript: navigation.
    if (rewriteJavascriptUrl(text, "null") !== null) return;
    const proxied = swapBlob(ctx.toProxy(text));
    // location and its members cannot be redefined by a page.
    const location = (target as { location: Location }).location;
    if (replace) invoke(location.replace, location, [proxied]);
    else if (!assignHref?.(location, proxied)) {
      const set = ownDescriptor(location, "href")?.set;
      if (set) invoke(set, location, [proxied]);
    }
  };

  const restrictedLocation = (target: object): object =>
    new NativeProxy(
      create(null) as object,
      {
        __proto__: null,
        get: (_dummy, property) => {
          if (typeof property === "symbol" || property === "then") return undefined;
          if (property === "replace") return (url: unknown) => navigate(target, url, true);
          return deny();
        },
        set: (_dummy, property, value) => {
          if (property !== "href") return deny();
          navigate(target, value, false);
          return true;
        },
        has: deny,
        ownKeys: () => ["href", "replace"],
        getOwnPropertyDescriptor: deny,
        defineProperty: deny,
        deleteProperty: deny,
        getPrototypeOf: () => null,
        setPrototypeOf: deny,
        preventExtensions: deny,
      } as ProxyHandler<object>,
    );

  const restrict = (target: object, headedElsewhere: boolean): object => {
    let location: object | null = null;
    let pending = headedElsewhere;
    /** A popup opened for another origin starts as this origin's blank page, so only its own address can vouch for it. */
    const reachable = (): boolean => {
      if (pending) {
        if (addressOrigin(target) === null) return false;
        pending = false;
      }
      return sameOrigin(target);
    };
    const bound = new NativeWeakMap<object, unknown>();
    const members: Record<string, unknown> = {
      __proto__: null,
      postMessage: (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) => {
        const realOrigin = realOriginOf(target, ctx.origin);
        // A window this realm cannot read is on another site host in subdomain mode.
        if (realOrigin === null && crossSite) return crossSite(target, message, targetOrigin, rest);
        post(
          (...args) => invoke(nativePost, target, args),
          realOrigin ?? "null",
          ctx.origin,
          message,
          targetOrigin,
          rest,
          selfOrigin(),
        );
      },
      close: () => methods.close && invoke(methods.close, target, []),
      focus: () => methods.focus && invoke(methods.focus, target, []),
      blur: () => methods.blur && invoke(methods.blur, target, []),
    };
    const crossOrigin = (property: string): unknown => {
      if (property in members) return members[property];
      if (property === "closed") return read(target, "closed") === true;
      if (property === "length") return +(read(target, "length") as number) || 0;
      if (property === "window" || property === "self" || property === "frames") return wrapper;
      if (property === "top" || property === "parent" || property === "opener") {
        const link = read(target, property);
        return isWindow(link) ? wrap(link) : null;
      }
      return wrap((target as Record<string, unknown>)[property]);
    };
    const allowed = (property: string | symbol): property is string =>
      typeof property === "string" && (property in CROSS_ORIGIN_KEYS || isIndex(property));
    const passthrough = (property: string | symbol): unknown => {
      const value: unknown = reflectGet(target, property, target);
      // The window itself, as `globalThis` names it, stays behind this wrapper.
      if (typeof value === "object") return isWindow(value) ? wrap(value) : value;
      // Constructors stay themselves, so `new` and instanceof work across the wrapper.
      if (typeof value !== "function" || ownDescriptor(value, "prototype")) return value;
      // Methods run on the window itself, not on the wrapper.
      let method = apply(mapGet, bound, [value]) as unknown;
      if (!method) {
        method = maskNative(function (this: unknown, ...args: unknown[]) {
          return apply(value as (...args: unknown[]) => unknown, target, args);
        }, value);
        apply(mapSet, bound, [value, method]);
      }
      return method;
    };

    const wrapper: object = new NativeProxy(
      create(null) as object,
      {
        __proto__: null,
        get: (_dummy, property) => {
          if (property === "location") {
            if (reachable()) return (target as { location: unknown }).location;
            return (location ??= restrictedLocation(target));
          }
          if (allowed(property)) return crossOrigin(property);
          if (reachable()) return passthrough(property);
          // Promise resolution and console inspection read these on any object.
          if (typeof property === "symbol" || property === "then") return undefined;
          return deny();
        },
        set: (_dummy, property, value) => {
          if (property === "location") {
            navigate(target, value, false);
            return true;
          }
          if (reachable()) return reflectSet(target, property, value, target);
          return deny();
        },
        has: (_dummy, property) => allowed(property) || (reachable() ? reflectHas(target, property) : deny()),
        ownKeys: () => reflectOwnKeys(reachable() ? target : CROSS_ORIGIN_KEYS),
        getOwnPropertyDescriptor: (_dummy, property) => {
          if (!allowed(property) && !reachable()) return deny();
          // Reported configurable, since the wrapper's own target never holds these.
          return {
            __proto__: null,
            value: allowed(property) ? crossOrigin(property) : passthrough(property),
            configurable: true,
          } as PropertyDescriptor;
        },
        defineProperty: (_dummy, property, descriptor) =>
          reachable() ? reflectDefine(target, property, descriptor) : deny(),
        deleteProperty: (_dummy, property) => (reachable() ? reflectDelete(target, property) : deny()),
        getPrototypeOf: () => (reachable() ? reflectProto(target) : null),
        setPrototypeOf: deny,
        preventExtensions: deny,
      } as ProxyHandler<object>,
    );
    return wrapper;
  };

  return {
    wrap,
    isWrapper,
    reset: () => {
      given = new NativeWeakSet<object>();
    },
  };
}

/** Window links a page reads from its own window: `parent` and `opener` are wrapped, `frameElement` hidden. */
export function installWindowLinks(win: Realm, ctx: UrlContext, guard: WindowGuard): void {
  const parentOf = ownDescriptor(win, "parent")?.get;
  const links = ["parent", "opener"];
  for (let index = 0; index < links.length; index++) {
    const name = links[index] as string;
    const descriptor = ownDescriptor(win, name);
    const get = descriptor?.get;
    if (!descriptor?.configurable || !get) continue;
    const hooked = function (): unknown {
      return guard.wrap(apply(get, win, []));
    };
    define(win, name, { ...descriptor, get: maskNative(hooked, get) });
  }
  const frameElement = ownDescriptor(win, "frameElement");
  const getElement = frameElement?.get;
  if (frameElement?.configurable && getElement && parentOf) {
    const hooked = function (): unknown {
      const element: unknown = apply(getElement, win, []);
      if (element === null) return element;
      const parent: unknown = apply(parentOf, win, []);
      return realOriginOf(parent, ctx.origin) === originOf(ctx.realUrl()) ? element : null;
    };
    define(win, "frameElement", { ...frameElement, get: maskNative(hooked, getElement) });
  }
}
