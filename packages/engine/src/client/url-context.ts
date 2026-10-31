import { decodeUrl } from "../shared/codec.ts";
import {
  apply,
  hashOf,
  hrefOf,
  isWebUrl,
  newUrl,
  originOf,
  parseUrl,
  pathnameOf,
  searchOf,
  setUrlPart,
  startsWith,
  toText,
} from "../shared/primordials.ts";
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

/** The real URL behind a proxy address on `proxyOrigin`, hash kept, or null for any other address. */
export function realUrlOf(href: string, proxyOrigin: string): URL | null {
  const native = parseUrl(href);
  if (!native || originOf(native) !== proxyOrigin) return null;
  const real = decodeUrl(pathnameOf(native) + searchOf(native));
  if (real) setUrlPart(real, "hash", hashOf(native));
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
    const web = startsWith(own, "https:") || startsWith(own, "http:");
    return web && url && originOf(url) === own ? own : null;
  } catch {
    // A window of an opaque origin hides both.
    return null;
  }
}

/** The site `other`'s own runtime holds, or undefined when this realm cannot ask it. */
export function engineSiteOf(other: unknown): string | undefined {
  try {
    const helpers = (other as { __g$?: { site?: unknown } }).__g$;
    const site: unknown = typeof helpers?.site === "function" ? apply(helpers.site, helpers, []) : undefined;
    return typeof site === "string" ? site : undefined;
  } catch {
    // A window of an opaque origin cannot be asked.
    return undefined;
  }
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
    return base ?? parseUrl(win.location.href) ?? newUrl(origin);
  };
  // Without a proxy address of its own, a window keeps the origin it was given first: a later document's tag may be one
  // the page planted.
  let pinned = originOf(realUrl());

  const realBase = (): URL => {
    const page = realUrl();
    const nativeBase = nativeBaseUri ? toText(apply(nativeBaseUri, win.document, [])) : hrefOf(page);
    try {
      const base = newUrl(unrewriteUrl(nativeBase, page, origin));
      // A blank or srcdoc frame reports an about: base that cannot resolve relative URLs; use the real page instead.
      return isWebUrl(base) ? base : page;
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
