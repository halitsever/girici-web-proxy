import { apply, define as defineOwn, originOf, parseUrl, toText } from "../shared/primordials.ts";
import { refererFor } from "../shared/referrer.ts";
import { realUrlOf, type Realm, type UrlContext } from "./url-context.ts";

/** Returns the reset a renewed document needs: the domain one document set must not carry over to the next. */
export function installDocument(win: Realm, ctx: UrlContext): () => void {
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
      const value = toText(apply(nativeReferrer, this, []));
      const url = parseUrl(value);
      if (!url) return "";
      if (originOf(url) !== ctx.origin) return value;
      // Only this origin's sealed addresses open here, so another site's sealed page leaves no referrer.
      const previous = realUrlOf(value, ctx.origin, ctx.openSealed);
      // The browser saw every proxied page as same-origin, so the real policy default is applied to real URLs.
      return previous ? (refererFor(previous, ctx.realUrl(), "") ?? "") : "";
    },
  });
  define(win.Node.prototype, "baseURI", {
    get(this: Node) {
      return ctx.fromProxy(toText(apply(nativeBaseUri, this, [])));
    },
  });
  defineOwn(win, "origin", { get: () => ctx.realUrl().origin, configurable: true, enumerable: true });
  return () => {
    domain = null;
  };
}

function getter(proto: object, name: string): (this: unknown) => unknown {
  const get = Object.getOwnPropertyDescriptor(proto, name)?.get;
  if (!get) throw new TypeError(`No getter for ${name}`);
  return get;
}

function define(proto: object, name: string, descriptor: PropertyDescriptor): void {
  defineOwn(proto, name, { configurable: true, enumerable: true, ...descriptor });
}
