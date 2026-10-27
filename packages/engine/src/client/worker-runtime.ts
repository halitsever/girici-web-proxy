import { createFakeLocation } from "./location.ts";
import { createHelpers } from "./helpers.ts";
import { rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

/** The worker globals this runtime touches; typed narrowly so it needs neither the DOM nor the WebWorker lib. */
interface WorkerScope {
  __giriciBase?: string;
  location: { origin: string; href: string };
  WorkerLocation?: { prototype: object };
  importScripts?: (...urls: string[]) => void;
  fetch?: (input: unknown, init?: unknown) => unknown;
  XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => void } };
  WebSocket?: unknown;
  WebSocketStream?: unknown;
  WebTransport?: unknown;
  eval: (code: string) => unknown;
  Request?: new (input: unknown, init?: unknown) => { url: string };
}

// globalThis is the worker scope at runtime; typed through WorkerScope to avoid the DOM and WebWorker libs.
const scope = globalThis as unknown as WorkerScope & Record<string, unknown>;

// The page passes the worker's real URL, since scope.location is the proxy or a blob address.
const base = scope.__giriciBase ?? scope.location.href;
const origin = scope.location.origin;
const realBase = (): URL => new URL(base);
// A worker loads from a blob address, so proxy URLs must be absolute for the worker to resolve them.
const toProxy = (raw: string): string => {
  const proxied = rewriteUrl(raw, realBase(), origin);
  return proxied.startsWith("/") ? origin + proxied : proxied;
};
const fromProxy = (value: string): string => unrewriteUrl(value, realBase(), origin);

install();

function install(): void {
  const fakeLocation = createFakeLocation(
    { real: realBase, navigate: () => {}, reload: () => {}, setHash: () => {} },
    scope.WorkerLocation?.prototype ?? Object.prototype,
  );
  const helpers = createHelpers({
    nativeLocation: scope.location,
    fakeLocation,
    isLocation: (value) => Object.prototype.toString.call(value) === "[object WorkerLocation]",
    fakeFor: () => null,
    // A worker has no window or document, so location writes fall through to the native (read-only) property.
    isWindowOrDocument: () => false,
    toProxy,
    rewrite: {
      js: (code) => code,
      jsBody: (code) => code,
      html: (html) => html,
      unhtml: (html) => html,
      importSpecifier: toProxy,
      metaUrl: fromProxy,
    },
    indirectEval: (code) => scope.eval(code as string),
  });
  Object.defineProperty(scope, "__g$", { value: helpers });

  hookImportScripts();
  hookFetch();
  hookXhr();
  blockRealtime();
}

function hookImportScripts(): void {
  const native = scope.importScripts;
  if (!native) return;
  scope.importScripts = (...urls: string[]) =>
    native.apply(
      scope,
      urls.map((url) => toProxy(String(url))),
    );
}

function hookFetch(): void {
  const native = scope.fetch;
  const Request = scope.Request;
  if (!native) return;
  scope.fetch = (input: unknown, init?: unknown) => {
    if (Request && input instanceof Request) {
      const url = toProxy(input.url);
      return native.call(scope, url === input.url ? input : new Request(url, input), init);
    }
    return native.call(scope, toProxy(String(input)), init);
  };
}

function hookXhr(): void {
  const proto = scope.XMLHttpRequest?.prototype;
  if (!proto) return;
  const open = proto.open;
  proto.open = function (this: unknown, method: unknown, url: unknown, ...rest: unknown[]) {
    open.call(this, method, toProxy(String(url)), ...rest);
  };
}

/** WebRTC leaks the real address and the socket relays are not here yet, so neither connects from a worker. */
function blockRealtime(): void {
  for (const name of ["WebSocketStream", "WebTransport", "RTCPeerConnection"]) Reflect.deleteProperty(scope, name);
  if (scope.WebSocket) scope.WebSocket = blockedWebSocket();
}

function blockedWebSocket(): unknown {
  return class WebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly url: string;
    readyState = 3;
    constructor(url: string) {
      this.url = String(url);
    }
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  };
}
