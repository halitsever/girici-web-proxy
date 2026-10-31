import { prefixFor } from "../shared/partition.ts";
import {
  apply,
  brandOf,
  define,
  hrefOf,
  isWebUrl,
  joined,
  mapOf,
  newUrl,
  originOf,
  parseUrl,
  startsWith,
  toText,
} from "../shared/primordials.ts";
import { rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";
import { hookConstructor } from "./constructors.ts";
import { createHelpers } from "./helpers.ts";
import { createFakeLocation } from "./location.ts";
import { installStorageIsolation } from "./storage-isolation.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { hookWorkers } from "./worker-bootstrap.ts";

/** The worker globals this runtime touches; typed narrowly so it needs neither the DOM nor the WebWorker lib. */
export interface WorkerScope {
  __giriciBase?: string;
  __giriciRuntime?: string;
  __giriciPartition?: string;
  location: { origin: string; href: string };
  WorkerLocation?: { prototype: object };
  importScripts?: (...urls: string[]) => void;
  fetch?: (input: unknown, init?: unknown) => unknown;
  XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => void } };
  WebSocket?: unknown;
  WebSocketStream?: unknown;
  WebTransport?: unknown;
  eval: (code: string) => unknown;
  Request?: { new (input: unknown, init?: unknown): { url: string }; prototype: object };
  EventSource?: new (url: string, init?: unknown) => object;
  navigator?: {
    sendBeacon?: (url: string, data?: unknown) => boolean;
  };
  Worker?: new (url: string, options?: unknown) => object;
  SharedWorker?: new (url: string, options?: unknown) => object;
  IDBFactory?: { prototype: object };
  CacheStorage?: { prototype: object };
  LockManager?: { prototype: object };
  BroadcastChannel?: new (name: string) => object;
  URL?: { createObjectURL(blob: unknown): string };
  Blob?: new (parts: string[], options?: { type?: string }) => unknown;
}

export function installWorker(scope: WorkerScope): void {
  if ("__g$" in scope) return;
  const boot = takeBoot(scope);
  const ctx = workerContext(scope, boot.base);
  const partition = boot.partition ?? prefixFor(ctx.realUrl().origin);
  // Taken before hookFetch, which would send the announcement to the proxied site.
  const nativeFetch = scope.fetch;

  define(scope, "__g$", { value: workerHelpers(scope, ctx) });
  maskOrigin(scope, ctx);
  installStorageIsolation(scope as unknown as Realm, ctx, () => partition);
  hookImportScripts(scope, ctx);
  hookFetch(scope, ctx);
  hookXhr(scope, ctx);
  hookSubresources(scope, ctx);
  // Nested workers get this worker's runtime and partition; a blob one also keeps this worker's base.
  hookWorkers(scope, {
    runtimeUrl: boot.runtimeUrl,
    origin: ctx.origin,
    fetch: nativeFetch,
    partition: () => partition,
    blobBase: () => ctx.realBase().href,
    resolve: (raw) => {
      const scriptUrl = ctx.toProxy(raw);
      return { scriptUrl, base: ctx.fromProxy(scriptUrl) };
    },
  });
  blockRealtime(scope);
}

/** The bootstrap leaves these on the global; they are removed so the worker's own script never sees them. */
function takeBoot(scope: WorkerScope): { base?: string; runtimeUrl?: string; partition?: string } {
  const boot = { base: scope.__giriciBase, runtimeUrl: scope.__giriciRuntime, partition: scope.__giriciPartition };
  const handed = ["__giriciBase", "__giriciRuntime", "__giriciPartition"];
  for (let index = 0; index < handed.length; index++) Reflect.deleteProperty(scope, handed[index] as string);
  return boot;
}

function workerContext(scope: WorkerScope, base: string | undefined): UrlContext {
  // The bootstrap passes the worker's real URL, since scope.location is the proxy or a blob address.
  const href = base ?? scope.location.href;
  const origin = scope.location.origin;
  const realBase = (): URL => newUrl(href);
  return {
    origin,
    realUrl: realBase,
    realBase,
    // A worker loads from a blob address, so a relative URL is resolved against the real base and proxied absolutely.
    toProxy: (raw) => {
      const absolute = parseUrl(raw, realBase());
      if (!absolute || !isWebUrl(absolute)) return raw;
      const proxied = rewriteUrl(hrefOf(absolute), realBase(), origin);
      return startsWith(proxied, "/") ? origin + proxied : proxied;
    },
    fromProxy: (value) => unrewriteUrl(value, realBase(), origin),
    // A worker never loads a second document.
    inherit: () => {},
    accepts: () => false,
  };
}

function workerHelpers(scope: WorkerScope, ctx: UrlContext) {
  const fakeLocation = createFakeLocation(
    { real: ctx.realBase, navigate: () => {}, reload: () => {}, setHash: () => {} },
    scope.WorkerLocation?.prototype ?? Object.prototype,
  );
  return createHelpers({
    nativeLocation: scope.location,
    fakeLocation,
    isLocation: (value) => brandOf(value) === "[object WorkerLocation]",
    fakeFor: () => null,
    // A worker has no window or document, so location writes fall through to the native (read-only) property.
    isWindowOrDocument: () => false,
    navigationUrl: ctx.toProxy,
    rewrite: {
      js: (code) => code,
      jsBody: (code) => code,
      html: (html) => html,
      srcdoc: (markup) => markup,
      unhtml: (html) => html,
      unsrcdoc: (markup) => markup,
      importSpecifier: ctx.toProxy,
      metaUrl: ctx.fromProxy,
    },
    indirectEval: (code) => scope.eval(code as string),
    // A worker cannot reach a window, so its ports and clients keep their own postMessage.
    messageTarget: (value) => value,
    wrapWindow: (value) => value,
    realOrigin: () => originOf(ctx.realBase()),
    site: () => undefined,
    // A worker never loads a second document.
    renew: () => false,
  });
}

/** self.origin is a separate global from self.location, so it is masked too or integrity checks see the proxy origin. */
function maskOrigin(scope: WorkerScope, ctx: UrlContext): void {
  try {
    define(scope, "origin", { configurable: true, get: () => ctx.realBase().origin });
  } catch {
    // Some engines make the global origin non-configurable; the leak then stands.
  }
}

/** Other network sinks a worker can reach, so none of them leaves the proxy or the cookie jar. */
function hookSubresources(scope: WorkerScope, ctx: UrlContext): void {
  if (scope.EventSource) {
    scope.EventSource = hookConstructor(scope.EventSource, (input) =>
      joined([ctx.toProxy(toText(input[0]))], input, 1),
    );
  }
  const navigator = scope.navigator;
  const sendBeacon = navigator?.sendBeacon;
  if (navigator && sendBeacon) {
    navigator.sendBeacon = (url: string, data?: unknown) =>
      apply(sendBeacon, navigator, [ctx.toProxy(toText(url)), data]);
  }
}

function hookImportScripts(scope: WorkerScope, ctx: UrlContext): void {
  const native = scope.importScripts;
  if (!native) return;
  scope.importScripts = (...urls: string[]) =>
    apply(
      native,
      scope,
      mapOf(urls, (url) => ctx.toProxy(toText(url))),
    );
}

function hookFetch(scope: WorkerScope, ctx: UrlContext): void {
  const native = scope.fetch;
  const Request = scope.Request;
  if (!native) return;
  // Addresses are read once through the native getter, so a script's getter cannot answer differently the second time.
  const requestUrl = Object.getOwnPropertyDescriptor(Request?.prototype ?? {}, "url")?.get as () => string;
  scope.fetch = (input: unknown, init?: unknown) => {
    if (Request && input instanceof Request) {
      const address = apply(requestUrl, input, []);
      const url = ctx.toProxy(address);
      return apply(native, scope, [url === address ? input : new Request(url, input), init]);
    }
    return apply(native, scope, [ctx.toProxy(toText(input)), init]);
  };
}

function hookXhr(scope: WorkerScope, ctx: UrlContext): void {
  const proto = scope.XMLHttpRequest?.prototype;
  if (!proto) return;
  const open = proto.open;
  proto.open = function (this: unknown, method: unknown, url: unknown, ...rest: unknown[]) {
    apply(open, this, joined([method, ctx.toProxy(toText(url))], rest));
  };
}

/** WebRTC leaks the real address and the socket relays are not here yet, so neither connects from a worker. */
function blockRealtime(scope: WorkerScope): void {
  const removed = ["WebSocketStream", "WebTransport", "RTCPeerConnection"];
  for (let index = 0; index < removed.length; index++) Reflect.deleteProperty(scope, removed[index] as string);
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
