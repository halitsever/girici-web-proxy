import type { Invoke } from "./invoke.ts";
import { post } from "./messaging.ts";
import { maskNative } from "./native-mask.ts";
import { apply, hrefOf, NativeWeakMap, NativeWeakSet, originOf, parseUrl, toText } from "../shared/primordials.ts";
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
const defineProperty = Object.defineProperty;
const create = Object.create;
const NativeProxy = Proxy;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;
const setHas = WeakSet.prototype.has;
const setAdd = WeakSet.prototype.add;

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

/** The real origin a window opened with the proxied URL `proxied` is headed to, or undefined for a blank one. */
export function openedOrigin(proxied: unknown, origin: string): string | undefined {
  if (proxied === undefined || proxied === null || proxied === "") return undefined;
  const address = parseUrl(toText(proxied), origin);
  const destination = address ? realUrlOf(hrefOf(address), origin) : null;
  return destination ? originOf(destination) : undefined;
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

export function createWindowGuard(win: Realm, ctx: UrlContext, invoke: Invoke): WindowGuard {
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

  const selfOrigin = () => originOf(ctx.realUrl());
  const sameOrigin = (target: object) => realOriginOf(target, ctx.origin) === selfOrigin();
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

  const wrap = (value: unknown, headedTo?: string): unknown => {
    if (!isWindow(value) || isWrapper(value) || apply(setHas, given, [value])) return value;
    const cached = apply(mapGet, wrappers, [value]) as object | undefined;
    if (cached) return cached;
    // A window handed out as is stays so: whoever got it keeps it anyway, and one window must stay one object.
    if (sameOrigin(value) && (headedTo === undefined || headedTo === selfOrigin())) {
      apply(setAdd, given, [value]);
      return value;
    }
    const wrapper = restrict(value);
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
    const proxied = ctx.toProxy(toText(url));
    // location and its members cannot be redefined by a page.
    const location = (target as { location: Location }).location;
    if (replace) invoke(location.replace, location, [proxied]);
    else {
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

  const restrict = (target: object): object => {
    let location: object | null = null;
    const bound = new NativeWeakMap<object, unknown>();
    const members: Record<string, unknown> = {
      __proto__: null,
      postMessage: (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) =>
        post(
          (...args) => invoke(nativePost, target, args),
          realOriginOf(target, ctx.origin) ?? "null",
          ctx.origin,
          message,
          targetOrigin,
          rest,
        ),
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
      if (typeof value !== "function") return value;
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
            if (sameOrigin(target)) return (target as { location: unknown }).location;
            return (location ??= restrictedLocation(target));
          }
          if (allowed(property)) return crossOrigin(property);
          if (sameOrigin(target)) return passthrough(property);
          // Promise resolution and console inspection read these on any object.
          if (typeof property === "symbol" || property === "then") return undefined;
          return deny();
        },
        set: (_dummy, property, value) => {
          if (property === "location") {
            navigate(target, value, false);
            return true;
          }
          if (sameOrigin(target)) return reflectSet(target, property, value, target);
          return deny();
        },
        has: (_dummy, property) => allowed(property) || (sameOrigin(target) ? reflectHas(target, property) : deny()),
        ownKeys: () => reflectOwnKeys(sameOrigin(target) ? target : CROSS_ORIGIN_KEYS),
        getOwnPropertyDescriptor: (_dummy, property) => {
          if (!allowed(property) && !sameOrigin(target)) return deny();
          // Reported configurable, since the wrapper's own target never holds these.
          return { value: allowed(property) ? crossOrigin(property) : passthrough(property), configurable: true };
        },
        defineProperty: (_dummy, property, descriptor) =>
          sameOrigin(target) ? reflectDefine(target, property, descriptor) : deny(),
        deleteProperty: (_dummy, property) => (sameOrigin(target) ? reflectDelete(target, property) : deny()),
        getPrototypeOf: () => (sameOrigin(target) ? reflectProto(target) : null),
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
  for (const name of ["parent", "opener"]) {
    const descriptor = ownDescriptor(win, name);
    const get = descriptor?.get;
    if (!descriptor?.configurable || !get) continue;
    const hooked = function (): unknown {
      return guard.wrap(apply(get, win, []));
    };
    defineProperty(win, name, { ...descriptor, get: maskNative(hooked, get) });
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
    defineProperty(win, "frameElement", { ...frameElement, get: maskNative(hooked, getElement) });
  }
}
