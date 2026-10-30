import { encodeUrl } from "../shared/codec.ts";
import { prefixFor } from "../shared/partition.ts";
import { TOP_SITE_QUERY } from "../shared/protocol.ts";
import { rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";
import { hookConstructor } from "./constructors.ts";
import { createHelpers } from "./helpers.ts";
import { createFakeLocation } from "./location.ts";
import { installStorageIsolation } from "./storage-isolation.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { workerBootstrapCode } from "./worker-bootstrap.ts";

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
  Request?: new (input: unknown, init?: unknown) => { url: string };
  EventSource?: new (url: string, init?: unknown) => object;
  navigator?: {
    sendBeacon?: (url: string, data?: unknown) => boolean;
    serviceWorker?: {
      addEventListener(
        type: "message",
        listener: (event: { data: unknown; ports: ReadonlyArray<{ postMessage(message: unknown): void }> }) => void,
      ): void;
      startMessages?(): void;
    };
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

  Object.defineProperty(scope, "__g$", { value: workerHelpers(scope, ctx) });
  maskOrigin(scope, ctx);
  installStorageIsolation(scope as unknown as Realm, ctx, () => partition);
  hookImportScripts(scope, ctx);
  hookFetch(scope, ctx);
  hookXhr(scope, ctx);
  hookSubresources(scope, ctx);
  hookNestedWorkers(scope, ctx, boot.runtimeUrl, partition);
  blockRealtime(scope);
  answerTopQueries(scope, ctx);
}

/** The bootstrap leaves these on the global; they are removed so the worker's own script never sees them. */
function takeBoot(scope: WorkerScope): { base?: string; runtimeUrl?: string; partition?: string } {
  const boot = { base: scope.__giriciBase, runtimeUrl: scope.__giriciRuntime, partition: scope.__giriciPartition };
  for (const name of ["__giriciBase", "__giriciRuntime", "__giriciPartition"]) Reflect.deleteProperty(scope, name);
  return boot;
}

function workerContext(scope: WorkerScope, base: string | undefined): UrlContext {
  // The bootstrap passes the worker's real URL, since scope.location is the proxy or a blob address.
  const href = base ?? scope.location.href;
  const origin = scope.location.origin;
  const realBase = (): URL => new URL(href);
  return {
    origin,
    realUrl: realBase,
    realBase,
    // A worker loads from a blob address, so a relative URL is resolved against the real base and proxied absolutely.
    toProxy: (raw) => {
      let absolute: URL;
      try {
        absolute = new URL(raw, realBase());
      } catch {
        return raw;
      }
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return raw;
      const proxied = rewriteUrl(absolute.href, realBase(), origin);
      return proxied.startsWith("/") ? origin + proxied : proxied;
    },
    fromProxy: (value) => unrewriteUrl(value, realBase(), origin),
    // A worker never loads a second document.
    inherit: () => {},
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
    isLocation: (value) => Object.prototype.toString.call(value) === "[object WorkerLocation]",
    fakeFor: () => null,
    // A worker has no window or document, so location writes fall through to the native (read-only) property.
    isWindowOrDocument: () => false,
    toProxy: ctx.toProxy,
    rewrite: {
      js: (code) => code,
      jsBody: (code) => code,
      html: (html) => html,
      unhtml: (html) => html,
      importSpecifier: ctx.toProxy,
      metaUrl: ctx.fromProxy,
    },
    indirectEval: (code) => scope.eval(code as string),
    // A worker cannot reach a window, so its ports and clients keep their own postMessage.
    messageTarget: (value) => value,
    // A worker never loads a second document.
    renew: () => false,
  });
}

/** self.origin is a separate global from self.location, so it is masked too or integrity checks see the proxy origin. */
function maskOrigin(scope: WorkerScope, ctx: UrlContext): void {
  try {
    Object.defineProperty(scope, "origin", { configurable: true, get: () => ctx.realBase().origin });
  } catch {
    // Some engines make the global origin non-configurable; the leak then stands.
  }
}

/** Other network sinks a worker can reach, so none of them leaves the proxy or the cookie jar. */
function hookSubresources(scope: WorkerScope, ctx: UrlContext): void {
  if (scope.EventSource) {
    scope.EventSource = hookConstructor(scope.EventSource, (input) => [
      ctx.toProxy(String(input[0])),
      ...input.slice(1),
    ]);
  }
  const navigator = scope.navigator;
  const sendBeacon = navigator?.sendBeacon;
  if (navigator && sendBeacon) {
    navigator.sendBeacon = (url: string, data?: unknown) => sendBeacon.call(navigator, ctx.toProxy(String(url)), data);
  }
}

/** Nested workers load through the same bootstrap as the page's, with this worker's runtime and partition. */
function hookNestedWorkers(
  scope: WorkerScope,
  ctx: UrlContext,
  runtimeUrl: string | undefined,
  partition: string,
): void {
  // Taken now, so a script that replaces them cannot hand the native constructor a script of its own.
  const urls = scope.URL;
  const createObjectURL = urls?.createObjectURL;
  const Blob = scope.Blob;
  const bootstrap = (raw: string, options: unknown): string => {
    if (!runtimeUrl || !createObjectURL || !Blob) throw new TypeError("Girici: no worker runtime to start this worker");
    // A blob worker has no real URL of its own, so it inherits this worker's.
    const blob = raw.startsWith("blob:");
    const scriptUrl = blob ? raw : ctx.toProxy(raw);
    const code = workerBootstrapCode({
      runtimeUrl,
      scriptUrl,
      base: blob ? ctx.realBase().href : ctx.fromProxy(scriptUrl),
      partition,
      module: (options as { type?: unknown } | null | undefined)?.type === "module",
    });
    return createObjectURL.call(urls, new Blob([code], { type: "text/javascript" }));
  };
  for (const name of ["Worker", "SharedWorker"] as const) {
    const Native = scope[name];
    if (!Native) continue;
    scope[name] = hookConstructor(Native, (input) => [bootstrap(String(input[0]), input[1]), ...input.slice(1)]);
  }
}

function hookImportScripts(scope: WorkerScope, ctx: UrlContext): void {
  const native = scope.importScripts;
  if (!native) return;
  scope.importScripts = (...urls: string[]) =>
    native.apply(
      scope,
      urls.map((url) => ctx.toProxy(String(url))),
    );
}

/** Requests a worker starts without fetch, such as XHR, still need its site; the service worker asks for it. */
function answerTopQueries(scope: WorkerScope, ctx: UrlContext): void {
  const container = scope.navigator?.serviceWorker;
  if (!container) return;
  container.addEventListener("message", (event) => {
    if ((event.data as { type?: unknown } | null)?.type !== TOP_SITE_QUERY) return;
    event.ports[0]?.postMessage({ top: ctx.realBase().href });
  });
  container.startMessages?.();
}

function hookFetch(scope: WorkerScope, ctx: UrlContext): void {
  const native = scope.fetch;
  const Request = scope.Request;
  if (!native) return;
  // The service worker sees this worker only as a blob: address, so its fetches name the real script as referrer.
  const withOwnReferrer = (init: unknown): unknown => {
    const options = (init ?? {}) as { referrer?: unknown };
    return options.referrer === undefined ? { ...options, referrer: ctx.origin + encodeUrl(ctx.realBase()) } : init;
  };
  scope.fetch = (input: unknown, init?: unknown) => {
    if (Request && input instanceof Request) {
      const url = ctx.toProxy(input.url);
      return native.call(scope, url === input.url ? input : new Request(url, input), withOwnReferrer(init));
    }
    return native.call(scope, ctx.toProxy(String(input)), withOwnReferrer(init));
  };
}

function hookXhr(scope: WorkerScope, ctx: UrlContext): void {
  const proto = scope.XMLHttpRequest?.prototype;
  if (!proto) return;
  const open = proto.open;
  proto.open = function (this: unknown, method: unknown, url: unknown, ...rest: unknown[]) {
    open.call(this, method, ctx.toProxy(String(url)), ...rest);
  };
}

/** WebRTC leaks the real address and the socket relays are not here yet, so neither connects from a worker. */
function blockRealtime(scope: WorkerScope): void {
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
