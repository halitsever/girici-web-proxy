import { define, joined, NativeWeakSet } from "../shared/primordials.ts";
import { HEADER } from "../shared/protocol.ts";
import { hookConstructor } from "./constructors.ts";
import type { CookieBridge } from "./cookies.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm, UrlContext } from "./url-context.ts";

// Taken at load, so a replaced Function.prototype.call or String never receives a native or the URL.
const apply = Reflect.apply;
const toText = String;
// A frame's requests pass through these in the realm of the page that made the frame.
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
// Install runs inside the page call that adopts a frame.
const ownDescriptor = Object.getOwnPropertyDescriptor;

/** Requests go out on proxy URLs, while the page keeps reading the real ones back. */
export function installNetwork(win: Realm, ctx: UrlContext, cookies: CookieBridge): void {
  const nativeFetch = win.fetch;
  const Request = win.Request;
  // The native getter, taken before the masking below wraps it, reads the address the request will really use.
  const requestUrl = ownDescriptor(Request.prototype, "url")?.get as (this: Request) => string;
  win.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const seq = cookies.currentSeq();
    let request: RequestInfo = proxiedInput(input);
    if (seq > 0) {
      const withSeq = new Request(request, init);
      // no-cors requests cannot carry custom headers; they simply skip the wait.
      if (withSeq.mode !== "no-cors") withSeq.headers.set(HEADER.cookieSeq, toText(seq));
      request = withSeq;
      init = undefined;
    }
    return apply(nativeFetch, win, [request, init]).then((response) => {
      cookies.applySync(response.headers.get(HEADER.cookieSync));
      return response;
    });
  };
  maskNative(win.fetch, nativeFetch);

  // A Request built from an already proxied URL is passed on unchanged. Its address is read once, since a page
  // getter could answer the foreign address first and the proxied one second.
  const proxiedInput = (input: RequestInfo | URL): RequestInfo => {
    if (!(input instanceof Request)) return ctx.toProxy(toText(input));
    const address = apply(requestUrl, input, []);
    const url = ctx.toProxy(address);
    return url === address ? input : new Request(url, input);
  };

  const fromProxy = (value: string) => (value ? ctx.fromProxy(value) : value);
  wrapGetter(win.Response.prototype, "url", fromProxy);
  wrapGetter(win.Request.prototype, "url", fromProxy);
  wrapGetter(win.XMLHttpRequest.prototype, "responseURL", fromProxy);
  wrapGetter(win.EventSource.prototype, "url", fromProxy);

  const xhr = win.XMLHttpRequest.prototype;
  const nativeOpen = xhr.open as (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) => void;
  xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    apply(nativeOpen, this, joined([method, ctx.toProxy(toText(url))], rest));
  } as typeof xhr.open;
  maskNative(xhr.open, nativeOpen);
  const { send: nativeSend, setRequestHeader: nativeSetRequestHeader } = xhr;
  const syncing = new NativeWeakSet<XMLHttpRequest>();
  xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const seq = cookies.currentSeq();
    if (seq > 0) apply(nativeSetRequestHeader, this, [HEADER.cookieSeq, toText(seq)]);
    if (!apply(weakHas, syncing, [this])) {
      apply(weakAdd, syncing, [this]);
      // Headers arrive before load, so cookies are in place by the time the page's handlers run.
      this.addEventListener("readystatechange", () => {
        if (this.readyState === this.HEADERS_RECEIVED) cookies.applySync(this.getResponseHeader(HEADER.cookieSync));
      });
    }
    apply(nativeSend, this, [body]);
  };
  maskNative(xhr.send, nativeSend);

  const navigatorProto = win.Navigator.prototype;
  const nativeBeacon = navigatorProto.sendBeacon;
  navigatorProto.sendBeacon = function (this: Navigator, url: string | URL, data?: BodyInit | null) {
    return apply(nativeBeacon, this, [ctx.toProxy(toText(url)), data]);
  };
  maskNative(navigatorProto.sendBeacon, nativeBeacon);

  win.EventSource = hookConstructor(win.EventSource, (input) => joined([ctx.toProxy(toText(input[0]))], input, 1));
}

function wrapGetter(proto: object, name: string, read: (value: string) => string): void {
  const descriptor = ownDescriptor(proto, name);
  const get = descriptor?.get;
  if (!get) return;
  define(proto, name, {
    ...descriptor,
    get(this: unknown) {
      return read(toText(apply(get, this, [])));
    },
  });
}
