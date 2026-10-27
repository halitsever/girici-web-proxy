import { HEADER } from "../shared/protocol.ts";
import type { CookieBridge } from "./cookies.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Requests go out on proxy URLs, while the page keeps reading the real ones back. */
export function installNetwork(win: Realm, ctx: UrlContext, cookies: CookieBridge): void {
  const nativeFetch = win.fetch;
  win.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const seq = cookies.currentSeq();
    let request: RequestInfo = proxiedInput(input);
    if (seq > 0) {
      const withSeq = new win.Request(request, init);
      // no-cors requests cannot carry custom headers; they simply skip the wait.
      if (withSeq.mode !== "no-cors") withSeq.headers.set(HEADER.cookieSeq, String(seq));
      request = withSeq;
      init = undefined;
    }
    return nativeFetch.call(win, request, init).then((response) => {
      cookies.applySync(response.headers.get(HEADER.cookieSync));
      return response;
    });
  };
  maskNative(win.fetch, nativeFetch);

  // A Request built from an already proxied URL is passed on unchanged.
  const proxiedInput = (input: RequestInfo | URL): RequestInfo => {
    if (!(input instanceof win.Request)) return ctx.toProxy(String(input));
    const url = ctx.toProxy(input.url);
    return url === input.url ? input : new win.Request(url, input);
  };

  const fromProxy = (value: string) => (value ? ctx.fromProxy(value) : value);
  wrapGetter(win.Response.prototype, "url", fromProxy);
  wrapGetter(win.Request.prototype, "url", fromProxy);
  wrapGetter(win.XMLHttpRequest.prototype, "responseURL", fromProxy);
  wrapGetter(win.EventSource.prototype, "url", fromProxy);

  const xhr = win.XMLHttpRequest.prototype;
  const nativeOpen = xhr.open as (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) => void;
  xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    nativeOpen.call(this, method, ctx.toProxy(String(url)), ...rest);
  } as typeof xhr.open;
  maskNative(xhr.open, nativeOpen);
  const { send: nativeSend, setRequestHeader: nativeSetRequestHeader } = xhr;
  const syncing = new WeakSet<XMLHttpRequest>();
  xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const seq = cookies.currentSeq();
    if (seq > 0) nativeSetRequestHeader.call(this, HEADER.cookieSeq, String(seq));
    if (!syncing.has(this)) {
      syncing.add(this);
      // Headers arrive before load, so cookies are in place by the time the page's handlers run.
      this.addEventListener("readystatechange", () => {
        if (this.readyState === this.HEADERS_RECEIVED) cookies.applySync(this.getResponseHeader(HEADER.cookieSync));
      });
    }
    nativeSend.call(this, body);
  };
  maskNative(xhr.send, nativeSend);

  const navigatorProto = win.Navigator.prototype;
  const nativeBeacon = navigatorProto.sendBeacon;
  navigatorProto.sendBeacon = function (this: Navigator, url: string | URL, data?: BodyInit | null) {
    return nativeBeacon.call(this, ctx.toProxy(String(url)), data);
  };
  maskNative(navigatorProto.sendBeacon, nativeBeacon);

  win.EventSource = new Proxy(win.EventSource, {
    construct: (target, args: [string | URL, EventSourceInit?], newTarget: NewableFunction) =>
      Reflect.construct(target, [ctx.toProxy(String(args[0])), args[1]], newTarget) as object,
  });
}

function wrapGetter(proto: object, name: string, read: (value: string) => string): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  const get = descriptor?.get;
  if (!get) return;
  Object.defineProperty(proto, name, {
    ...descriptor,
    get(this: unknown) {
      return read(String(get.call(this)));
    },
  });
}
