import type { RewriteBridge } from "./rewrite-bridge.ts";

export interface HelperEnv {
  nativeLocation: object;
  fakeLocation: object;
  isLocation(value: unknown): boolean;
  fakeFor(location: object): object | null;
  isWindowOrDocument(value: unknown): boolean;
  toProxy(raw: string): string;
  rewrite: RewriteBridge;
  indirectEval(code: unknown): unknown;
  messageTarget(value: unknown): unknown;
  renew(): boolean;
}

export interface GiriciHelpers {
  L(value: unknown): unknown;
  N(target: unknown, value: unknown): unknown;
  S(object: unknown, key: string, value: unknown): unknown;
  D(object: unknown): unknown;
  E(code: unknown): unknown;
  ev(code: unknown): unknown;
  I(spec: unknown): string;
  H(html: unknown): string;
  M(url: unknown): string;
  P(value: unknown): unknown;
  /** A javascript: URL's code. A string result is the window's next document, so it comes back with the runtime. */
  J(code: unknown): string | undefined;
  /** The engine script of a document that reuses this window calls this instead of installing again. */
  renew(): boolean;
}

// Taken at load, so a page that replaced String never sees the code on its way to the rewriter.
const toText = String;

/** The functions rewritten scripts call in place of reading or writing `location`. */
export function createHelpers(env: HelperEnv): GiriciHelpers {
  const isRealLocation = (value: unknown): value is object =>
    value === env.nativeLocation || (typeof value === "object" && value !== null && env.isLocation(value));

  const L = (value: unknown): unknown => {
    if (value === env.nativeLocation) return env.fakeLocation;
    if (isRealLocation(value)) return env.fakeFor(value) ?? value;
    return value;
  };

  return {
    L,
    N: (target, value) => (isRealLocation(target) ? env.toProxy(String(value)) : value),
    S: (object, key, value) => {
      if (env.isWindowOrDocument(object)) {
        const location = (object as { location: { href: string } }).location;
        const fake = L(location) as { href: string };
        // A window whose stand-in cannot be found still must not navigate outside the proxy.
        if (fake === location) location.href = env.toProxy(String(value));
        else fake.href = String(value);
      } else {
        (object as Record<string, unknown>)[key] = value;
      }
      return value;
    },
    D: (object) => {
      if (!env.isWindowOrDocument(object)) return object;
      // A null prototype keeps traps a page adds to Object.prototype out of this handler.
      return new Proxy(
        object as object,
        {
          __proto__: null,
          get: (target, property) => {
            const value: unknown = Reflect.get(target, property, target);
            return property === "location" ? L(value) : value;
          },
        } as ProxyHandler<object>,
      );
    },
    // eval returns non-string arguments untouched, so only code strings are rewritten.
    E: (code) => (typeof code === "string" ? env.rewrite.js(code) : code),
    ev: (code) => env.indirectEval(typeof code === "string" ? env.rewrite.js(code) : code),
    I: (spec) => env.rewrite.importSpecifier(String(spec)),
    H: (html) => env.rewrite.html(String(html)),
    M: (url) => env.rewrite.metaUrl(String(url)),
    P: (value) => env.messageTarget(value),
    J: (code) => {
      const result = env.indirectEval(env.rewrite.js(toText(code)));
      return typeof result === "string" ? env.rewrite.srcdoc(result) : undefined;
    },
    renew: () => env.renew(),
  };
}
