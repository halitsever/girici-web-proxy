import { toText } from "../shared/primordials.ts";
import type { RewriteBridge } from "./rewrite-bridge.ts";

export interface HelperEnv {
  nativeLocation: object;
  fakeLocation: object;
  isLocation(value: unknown): boolean;
  fakeFor(location: object): object | null;
  isWindowOrDocument(value: unknown): boolean;
  /** Whether a value is a window, by a check that runs none of a page's getters or proxy traps. */
  isWindow(value: unknown): boolean;
  /** A navigation's URL as the browser must see it: proxied, and a blob swapped for its bootstrap. */
  navigationUrl(raw: string): string;
  rewrite: RewriteBridge;
  indirectEval(code: unknown): unknown;
  messageTarget(value: unknown): unknown;
  /** Another origin's window becomes a restricted wrapper; anything else comes back as is. */
  wrapWindow(value: unknown): unknown;
  /** This window's real origin, which other windows read here because a page can redefine `origin`. */
  realOrigin(): string;
  /** The registrable site this window's runtime was given, which frames compare their own claimed site against. */
  site(): string | undefined;
  renew(): boolean;
}

export interface GiriciHelpers {
  L(value: unknown): unknown;
  N(target: unknown, value: unknown): unknown;
  S(object: unknown, key: string, value: unknown): unknown;
  /** `obj.location` as a target the page names in place: `v` reads it as a read would and writes it as S does. */
  A(object: unknown): { v: unknown };
  D(object: unknown): unknown;
  E(code: unknown): unknown;
  ev(code: unknown): unknown;
  I(spec: unknown): string;
  H(html: unknown): string;
  M(url: unknown): string;
  P(value: unknown): unknown;
  /** A javascript: URL's code. A string result is the window's next document, so it comes back with the runtime. */
  J(code: unknown, owner?: unknown): string | undefined;
  W(value: unknown): unknown;
  /** A value read at a key only known at run time: a Location becomes its stand-in and another window is wrapped. */
  V(value: unknown): unknown;
  /** `object[key]` as a target, with the key converted once: `v` reads it as V does and writes `location` as S does. */
  K(object: unknown, key: unknown): { v: unknown };
  realOrigin(): string;
  site(): string | undefined;
  /** The engine script of a document that reuses this window calls this instead of installing again. */
  renew(): boolean;
}

// Taken at load: the destructuring proxy is made and read through on page calls.
const reflectGet = Reflect.get;
const reflectSet = Reflect.set;
const NativeProxy = Proxy;

/** Window links that can lead to another origin's window. A null prototype keeps page additions out of `in`. */
const WINDOW_LINKS: Record<string, true> = Object.assign(Object.create(null) as Record<string, true>, {
  top: true,
  parent: true,
  opener: true,
  frames: true,
});

/** ToPropertyKey, so a key object's toString runs once, as it would for the page's own access. */
export function propertyKey(key: unknown): PropertyKey {
  return typeof key === "symbol" ? key : toText(key);
}

/** The functions rewritten scripts call in place of reading or writing `location`. */
export function createHelpers(env: HelperEnv): GiriciHelpers {
  const isRealLocation = (value: unknown): value is object =>
    value === env.nativeLocation || (typeof value === "object" && value !== null && env.isLocation(value));

  const L = (value: unknown): unknown => {
    if (value === env.nativeLocation) return env.fakeLocation;
    if (isRealLocation(value)) return env.fakeFor(value) ?? value;
    return value;
  };

  const S = (object: unknown, key: string, value: unknown): unknown => {
    if (env.isWindowOrDocument(object)) {
      const location = (object as { location: { href: string } }).location;
      const fake = L(location) as { href: string };
      // A window whose stand-in cannot be found still must not navigate outside the proxy.
      if (fake === location) location.href = env.navigationUrl(toText(value));
      else fake.href = toText(value);
    } else {
      (object as Record<string, unknown>)[key] = value;
    }
    return value;
  };

  const V = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return value;
    if (isRealLocation(value)) return L(value);
    return env.isWindow(value) ? env.wrapWindow(value) : value;
  };

  return {
    L,
    N: (target, value) => (isRealLocation(target) ? env.navigationUrl(toText(value)) : value),
    S,
    A: (object) =>
      ({
        __proto__: null,
        get v() {
          const value = (object as { location: unknown }).location;
          return env.isWindowOrDocument(object) ? L(value) : value;
        },
        set v(value: unknown) {
          S(object, "location", value);
        },
      }) as unknown as { v: unknown },
    D: (object) => {
      if (!env.isWindowOrDocument(object)) return object;
      // A null prototype keeps traps a page adds to Object.prototype out of this handler.
      return new NativeProxy(
        object as object,
        {
          __proto__: null,
          get: (target, property) => {
            const value: unknown = reflectGet(target, property, target);
            if (property === "location") return L(value);
            return typeof property === "string" && property in WINDOW_LINKS ? env.wrapWindow(value) : V(value);
          },
        } as ProxyHandler<object>,
      );
    },
    // eval returns non-string arguments untouched, so only code strings are rewritten.
    E: (code) => (typeof code === "string" ? env.rewrite.js(code) : code),
    ev: (code) => env.indirectEval(typeof code === "string" ? env.rewrite.js(code) : code),
    I: (spec) => env.rewrite.importSpecifier(toText(spec)),
    H: (html) => env.rewrite.html(toText(html)),
    M: (url) => env.rewrite.metaUrl(toText(url)),
    P: (value) => env.messageTarget(value),
    J: (code, owner) => {
      // A browser runs a javascript: URL only for a document of the target's origin; another site's is dropped.
      if (owner !== env.realOrigin()) return undefined;
      const result = env.indirectEval(env.rewrite.js(toText(code)));
      return typeof result === "string" ? env.rewrite.srcdoc(result) : undefined;
    },
    W: (value) => env.wrapWindow(value),
    V,
    K: (object, key) => {
      const property = propertyKey(key);
      return {
        __proto__: null,
        get v() {
          return V((object as Record<PropertyKey, unknown>)[property]);
        },
        set v(value: unknown) {
          if (property === "location" && env.isWindowOrDocument(object)) S(object, property, value);
          else if (object === null || object === undefined)
            (object as unknown as Record<PropertyKey, unknown>)[property] = value;
          // Without throwing, as a sloppy page's own write would not; a primitive takes no property at all.
          else if (typeof object === "object" || typeof object === "function") reflectSet(object, property, value);
        },
      } as unknown as { v: unknown };
    },
    realOrigin: () => env.realOrigin(),
    site: () => env.site(),
    renew: () => env.renew(),
  };
}
