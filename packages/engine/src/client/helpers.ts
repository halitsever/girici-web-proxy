import { toText } from "../shared/primordials.ts";
import type { RewriteBridge } from "./rewrite-bridge.ts";

export interface HelperEnv {
  nativeLocation: object;
  fakeLocation: object;
  isLocation(value: unknown): boolean;
  fakeFor(location: object): object | null;
  isWindowOrDocument(value: unknown): boolean;
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
  /** `op` is the logical assignment operator, when the page wrote one. */
  S(object: unknown, key: string, value: unknown, op?: string): unknown;
  D(object: unknown): unknown;
  E(code: unknown): unknown;
  ev(code: unknown): unknown;
  I(spec: unknown): string;
  H(html: unknown): string;
  M(url: unknown): string;
  P(value: unknown): unknown;
  /** A javascript: URL's code. A string result is the window's next document, so it comes back with the runtime. */
  J(code: unknown): string | undefined;
  W(value: unknown): unknown;
  realOrigin(): string;
  site(): string | undefined;
  /** The engine script of a document that reuses this window calls this instead of installing again. */
  renew(): boolean;
}

// Taken at load: the destructuring proxy reads through it on page calls.
const reflectGet = Reflect.get;

/** Window links that can lead to another origin's window. A null prototype keeps page additions out of `in`. */
const WINDOW_LINKS: Record<string, true> = Object.assign(Object.create(null) as Record<string, true>, {
  top: true,
  parent: true,
  opener: true,
  frames: true,
});

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
    N: (target, value) => (isRealLocation(target) ? env.navigationUrl(toText(value)) : value),
    S: (object, key, value, op) => {
      if (env.isWindowOrDocument(object)) {
        const location = (object as { location: { href: string } }).location;
        const fake = L(location) as { href: string };
        // A Location is always truthy: `||=` and `??=` never assign, `&&=` always does.
        if (op === "||=" || op === "??=") return fake;
        // A window whose stand-in cannot be found still must not navigate outside the proxy.
        if (fake === location) location.href = env.navigationUrl(toText(value));
        else fake.href = toText(value);
        return value;
      }
      const target = object as Record<string, unknown>;
      if (op === "&&=") return target[key] && (target[key] = value);
      if (op === "||=") return target[key] || (target[key] = value);
      if (op === "??=") return target[key] ?? (target[key] = value);
      return (target[key] = value);
    },
    D: (object) => {
      if (!env.isWindowOrDocument(object)) return object;
      // A null prototype keeps traps a page adds to Object.prototype out of this handler.
      return new Proxy(
        object as object,
        {
          __proto__: null,
          get: (target, property) => {
            const value: unknown = reflectGet(target, property, target);
            if (property === "location") return L(value);
            return typeof property === "string" && property in WINDOW_LINKS ? env.wrapWindow(value) : value;
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
    J: (code) => {
      const result = env.indirectEval(env.rewrite.js(toText(code)));
      return typeof result === "string" ? env.rewrite.srcdoc(result) : undefined;
    },
    W: (value) => env.wrapWindow(value),
    realOrigin: () => env.realOrigin(),
    site: () => env.site(),
    renew: () => env.renew(),
  };
}
