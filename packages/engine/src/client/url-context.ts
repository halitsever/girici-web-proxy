import { decodeUrl } from "../shared/codec.ts";
import { rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

/** A window together with its own constructors, so hooks patch the realm they are installed into. */
export type Realm = Window & typeof globalThis;

export interface UrlContext {
  origin: string;
  realUrl(): URL;
  realBase(): URL;
  toProxy(raw: string): string;
  fromProxy(value: string): string;
}

/** Must be created before the hooks so it keeps reading the browser's own proxy URLs. */
export function createUrlContext(win: Realm): UrlContext {
  const origin = win.location.origin;
  const nativeBaseUri = Object.getOwnPropertyDescriptor(win.Node.prototype, "baseURI")?.get;

  const realUrl = (): URL => {
    const native = new URL(win.location.href);
    const real = native.origin === origin ? decodeUrl(native.pathname + native.search) : null;
    if (!real) return native;
    real.hash = native.hash;
    return real;
  };

  const realBase = (): URL => {
    const page = realUrl();
    const nativeBase = nativeBaseUri ? String(nativeBaseUri.call(win.document)) : page.href;
    try {
      return new URL(unrewriteUrl(nativeBase, page, origin));
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
  };
}
