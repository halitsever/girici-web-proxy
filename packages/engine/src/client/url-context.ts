import { decodeUrl, encodeUrl } from "../shared/codec.ts";
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
import type { InheritedContext, OriginSeal } from "../shared/protocol.ts";
import { createOriginSealer, isSealedPath, type OpenSealed } from "../shared/sealed-address.ts";
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
  /** The document sits on a sealed address, so relative URLs written into it must be absolute. */
  opaque(): boolean;
  /** Where this window navigates to load `url`: sealed for its own origin while it holds a seal. Keeps the fragment. */
  documentAddress(url: URL): string;
  /** Opens this origin's sealed addresses; null without a seal. */
  openSealed: OpenSealed;
  /** A reused window takes the new document's inherited context and seal, or none. */
  inherit(next: InheritedContext | undefined, seal?: OriginSeal): void;
  /** Whether a document that reuses this window may take `next` without changing the window's real origin. */
  accepts(next: InheritedContext | undefined, seal?: OriginSeal): boolean;
}

/** The real URL behind a proxy address on `proxyOrigin`, hash kept, or null for any other address. */
export function realUrlOf(href: string, proxyOrigin: string, open?: OpenSealed): URL | null {
  const native = parseUrl(href);
  if (!native || originOf(native) !== proxyOrigin) return null;
  const pathAndQuery = pathnameOf(native) + searchOf(native);
  const real = isSealedPath(pathnameOf(native)) ? (open ? open(pathAndQuery) : null) : decodeUrl(pathAndQuery);
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

type OriginSealer = NonNullable<ReturnType<typeof createOriginSealer>>;

/** Must be created before the hooks so it keeps reading the browser's own proxy URLs. */
export function createUrlContext(win: Realm, initial?: InheritedContext, seal?: OriginSeal): UrlContext {
  const origin = initial?.origin ?? win.location.origin;
  let inherited = initial;
  const nativeBaseUri = Object.getOwnPropertyDescriptor(win.Node.prototype, "baseURI")?.get;
  let sealer: OriginSealer | null = null;
  const openSealed: OpenSealed = (pathAndQuery) => (sealer ? sealer.open(pathAndQuery) : null);
  // location and its href cannot be redefined by a page.
  const ownUrl = () => realUrlOf(win.location.href, origin, openSealed);
  const sealedPath = (href: string): string | null => {
    const url = parseUrl(href);
    return url && originOf(url) === origin && isSealedPath(pathnameOf(url)) ? pathnameOf(url) + searchOf(url) : null;
  };

  /**
   * A seal counts only when it opens the window's own sealed address, or names the origin of its plain one, so a tag
   * the page planted cannot hand the window another origin's addresses.
   */
  const fitting = (offered: OriginSeal | undefined): OriginSealer | null => {
    const candidate = offered ? createOriginSealer(offered) : null;
    if (!candidate) return null;
    const sealed = sealedPath(win.location.href);
    if (sealed !== null) return candidate.open(sealed) ? candidate : null;
    const plain = realUrlOf(win.location.href, origin);
    return plain && originOf(plain) === candidate.origin ? candidate : null;
  };
  sealer = fitting(seal);

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

  const nativeBase = (): string | null => (nativeBaseUri ? toText(apply(nativeBaseUri, win.document, [])) : null);
  const realBase = (): URL => {
    const page = realUrl();
    const base = nativeBase() ?? hrefOf(page);
    // A srcdoc frame of a sealed page has that page's sealed base, which only the page's own key opens.
    const sealed = sealedPath(base);
    if (sealed !== null) return openSealed(sealed) ?? page;
    try {
      const resolved = newUrl(unrewriteUrl(base, page, origin, openSealed));
      // A blank or srcdoc frame reports an about: base that cannot resolve relative URLs; use the real page instead.
      return isWebUrl(resolved) ? resolved : page;
    } catch {
      return page;
    }
  };
  const opaque = (): boolean => {
    if (sealedPath(win.location.href) !== null) return true;
    const base = nativeBase();
    return base !== null && sealedPath(base) !== null;
  };

  return {
    origin,
    realUrl,
    realBase,
    toProxy: (raw) => rewriteUrl(raw, realBase(), origin, originOf(realUrl()), opaque()),
    fromProxy: (value) => unrewriteUrl(value, realBase(), origin, openSealed),
    opaque,
    documentAddress: (url) => (sealer ? sealer.seal(url) : null) ?? encodeUrl(url),
    openSealed,
    inherit: (next, offered) => {
      inherited = next;
      sealer = fitting(offered);
      const own = ownUrl();
      if (own) pinned = originOf(own);
    },
    accepts: (next, offered) => {
      if (ownUrl() || fitting(offered)) return true;
      const base = next ? parseUrl(next.base) : null;
      return base !== null && originOf(base) === pinned;
    },
  };
}
