import { PROXY_PREFIX } from "../shared/codec.ts";
import type { InheritedContext } from "../shared/protocol.ts";
import { rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

export type { InheritedContext };

/** A window together with its own constructors, so hooks patch the realm they are installed into. */
export type Realm = Window & typeof globalThis;

export interface UrlContext {
  origin: string;
  realUrl(): URL;
  realBase(): URL;
  toProxy(raw: string): string;
  fromProxy(value: string): string;
  /** A reused window takes the new document's inherited context, or none. */
  inherit(next: InheritedContext | undefined): void;
  /** Whether a document that reuses this window may take `next` without changing the window's real origin. */
  accepts(next: InheritedContext | undefined): boolean;
}

// Taken at load: storage partitions and window access follow the real URL, so page code must not steer how it is read.
const apply = Reflect.apply;
const NativeURL = URL;
const urlGetter = (name: string) => Object.getOwnPropertyDescriptor(URL.prototype, name)?.get as (this: URL) => string;
const originGetter = urlGetter("origin");
const hrefGetter = urlGetter("href");
const pathnameOf = urlGetter("pathname");
const searchOf = urlGetter("search");
const hashOf = urlGetter("hash");
const usernameOf = urlGetter("username");
const passwordOf = urlGetter("password");
const hostnameOf = urlGetter("hostname");
const setHash = Object.getOwnPropertyDescriptor(URL.prototype, "hash")?.set as (this: URL, value: string) => void;
const startsWith = String.prototype.startsWith;
const slice = String.prototype.slice;
const indexOf = String.prototype.indexOf;

export function parseUrl(raw: string, base?: string): URL | null {
  try {
    return base === undefined ? new NativeURL(raw) : new NativeURL(raw, base);
  } catch {
    return null;
  }
}

export function originOf(url: URL): string {
  return apply(originGetter, url, []);
}

export function hrefOf(url: URL): string {
  return apply(hrefGetter, url, []);
}

/** The real URL behind a proxy address on `proxyOrigin`, hash kept, or null for any other address. */
export function realUrlOf(href: string, proxyOrigin: string): URL | null {
  const native = parseUrl(href);
  if (!native || originOf(native) !== proxyOrigin) return null;
  const real = decodePath(apply(pathnameOf, native, []) + apply(searchOf, native, []));
  if (real) apply(setHash, real, [apply(hashOf, native, [])]);
  return real;
}

/**
 * The decoded proxy address of `other`, else the origin its own runtime reports through `__g$`, which its page cannot
 * redefine the way it can redefine `origin`. Null when neither names an http(s) origin other than ours.
 */
export function realOriginOf(other: unknown, proxyOrigin: string): string | null {
  try {
    const real = realUrlOf((other as { location: { href: string } }).location.href, proxyOrigin);
    if (real) return originOf(real);
    const helpers = (other as { __g$?: { realOrigin?: unknown } }).__g$;
    const own: unknown = typeof helpers?.realOrigin === "function" ? apply(helpers.realOrigin, helpers, []) : null;
    if (typeof own !== "string" || own === proxyOrigin) return null;
    const url = parseUrl(own);
    const web = apply(startsWith, own, ["https:"]) || apply(startsWith, own, ["http:"]);
    return web && url && originOf(url) === own ? own : null;
  } catch {
    // A window of an opaque origin hides both.
    return null;
  }
}

/** codec's decodeUrl through the methods taken above. */
function decodePath(pathAndQuery: string): URL | null {
  if (!apply(startsWith, pathAndQuery, [PROXY_PREFIX])) return null;
  const rest = apply(slice, pathAndQuery, [PROXY_PREFIX.length]) as string;
  const slash = apply(indexOf, rest, ["/"]) as number;
  if (slash <= 0) return null;
  const scheme = apply(slice, rest, [0, slash]) as string;
  if (scheme !== "http" && scheme !== "https") return null;
  const remainder = apply(slice, rest, [slash + 1]) as string;
  if (!remainder || apply(startsWith, remainder, ["/"])) return null;
  const url = parseUrl(`${scheme}://${remainder}`);
  if (!url || apply(usernameOf, url, []) || apply(passwordOf, url, []) || !apply(hostnameOf, url, [])) return null;
  return url;
}

/** Must be created before the hooks so it keeps reading the browser's own proxy URLs. */
export function createUrlContext(win: Realm, initial?: InheritedContext): UrlContext {
  const origin = initial?.origin ?? win.location.origin;
  let inherited = initial;
  const nativeBaseUri = Object.getOwnPropertyDescriptor(win.Node.prototype, "baseURI")?.get;
  // location and its href cannot be redefined by a page.
  const ownUrl = () => realUrlOf(win.location.href, origin);

  const realUrl = (): URL => {
    const real = ownUrl();
    if (real) return real;
    // A frame with an opaque address takes the inherited base, if it is usable.
    const base = inherited ? parseUrl(inherited.base) : null;
    return base ?? parseUrl(win.location.href) ?? new NativeURL(origin);
  };
  // Without a proxy address of its own, a window keeps the origin it was given first: a later document's tag may be one
  // the page planted.
  let pinned = originOf(realUrl());

  const realBase = (): URL => {
    const page = realUrl();
    const nativeBase = nativeBaseUri ? String(nativeBaseUri.call(win.document)) : page.href;
    try {
      const base = new URL(unrewriteUrl(nativeBase, page, origin));
      // A blank or srcdoc frame reports an about: base that cannot resolve relative URLs; use the real page instead.
      return base.protocol === "http:" || base.protocol === "https:" ? base : page;
    } catch {
      return page;
    }
  };

  return {
    origin,
    realUrl,
    realBase,
    toProxy: (raw) => rewriteUrl(raw, realBase(), origin),
    fromProxy: (value) => unrewriteUrl(value, realBase(), origin),
    inherit: (next) => {
      inherited = next;
      const own = ownUrl();
      if (own) pinned = originOf(own);
    },
    accepts: (next) => {
      if (ownUrl()) return true;
      const base = next ? parseUrl(next.base) : null;
      return base !== null && originOf(base) === pinned;
    },
  };
}
