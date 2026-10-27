import { decodeUrl } from "../shared/codec.ts";
import { refererFor } from "../shared/referrer.ts";
import type { Realm, UrlContext } from "./url-context.ts";

export function installDocument(win: Realm, ctx: UrlContext): void {
  const documentProto = win.Document.prototype;
  const nativeReferrer = getter(documentProto, "referrer");
  const nativeBaseUri = getter(win.Node.prototype, "baseURI");
  let domain: string | null = null;

  define(documentProto, "URL", { get: () => ctx.realUrl().href });
  define(documentProto, "documentURI", { get: () => ctx.realUrl().href });
  define(documentProto, "domain", {
    get: () => domain ?? ctx.realUrl().hostname,
    set: (value: unknown) => {
      const host = ctx.realUrl().hostname;
      const next = String(value).toLowerCase();
      // The real setter would compare against our origin and throw, so the browser's suffix rule is applied here.
      if (next !== host && !(next.includes(".") && host.endsWith(`.${next}`))) {
        throw new win.DOMException(`"${next}" is not a suffix of "${host}".`, "SecurityError");
      }
      domain = next;
    },
  });
  define(documentProto, "referrer", {
    get(this: Document) {
      const value = String(nativeReferrer.call(this));
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return "";
      }
      if (url.origin !== ctx.origin) return value;
      const previous = decodeUrl(url.pathname + url.search);
      // The browser saw every proxied page as same-origin, so the real policy default is applied to real URLs.
      return previous ? (refererFor(previous, ctx.realUrl(), "") ?? "") : "";
    },
  });
  define(win.Node.prototype, "baseURI", {
    get(this: Node) {
      return ctx.fromProxy(String(nativeBaseUri.call(this)));
    },
  });
  Object.defineProperty(win, "origin", { get: () => ctx.realUrl().origin, configurable: true, enumerable: true });
}

function getter(proto: object, name: string): (this: unknown) => unknown {
  const get = Object.getOwnPropertyDescriptor(proto, name)?.get;
  if (!get) throw new TypeError(`No getter for ${name}`);
  return get;
}

function define(proto: object, name: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(proto, name, { configurable: true, enumerable: true, ...descriptor });
}
