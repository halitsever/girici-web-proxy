import { decodeUrl } from "../shared/codec.ts";
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
}

/** Must be created before the hooks so it keeps reading the browser's own proxy URLs. */
export function createUrlContext(win: Realm, initial?: InheritedContext): UrlContext {
  const origin = initial?.origin ?? win.location.origin;
  let inherited = initial;
  const nativeBaseUri = Object.getOwnPropertyDescriptor(win.Node.prototype, "baseURI")?.get;

  const realUrl = (): URL => {
    let native: URL | null = null;
    try {
      native = new URL(win.location.href);
    } catch {
      // A frame with an opaque address cannot be parsed; the inherited base stands in.
    }
    const real = native && native.origin === origin ? decodeUrl(native.pathname + native.search) : null;
    if (native && real) {
      real.hash = native.hash;
      return real;
    }
    if (inherited) {
      try {
        return new URL(inherited.base);
      } catch {
        // An unusable inherited base falls back to the frame's own address.
      }
    }
    return native ?? new URL(origin);
  };

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
    },
  };
}
