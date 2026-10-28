import { decodeUrl } from "../shared/codec.ts";
import type { ClientConfig } from "../shared/protocol.ts";
import { installAttributes } from "./attributes.ts";
import { installCookies, type CookieBridge } from "./cookies.ts";
import { installDocument } from "./document.ts";
import { installFrames } from "./frames.ts";
import { createHelpers } from "./helpers.ts";
import { createFakeLocation } from "./location.ts";
import { installHtmlSinks } from "./html-sinks.ts";
import { createRewriteBridge } from "./rewrite-bridge.ts";
import { installScriptExec } from "./script-exec.ts";
import { installToStringMask } from "./native-mask.ts";
import { installWorkers } from "./workers.ts";
import { installNavigation } from "./navigation.ts";
import { installNetwork } from "./network.ts";
import { installRealtimeBlock } from "./realtime.ts";
import { installWebSocket } from "./websocket.ts";
import { installStorage } from "./storage.ts";
import { installStorageIsolation } from "./storage-isolation.ts";
import { installMessaging } from "./messaging.ts";
import { installPermissions } from "./permissions.ts";
import { installMasking } from "./masking.ts";
import { installServiceWorkerMask } from "./sw-mask.ts";
import { createUrlContext, type InheritedContext, type Realm } from "./url-context.ts";

export function install(win: Realm, config: ClientConfig, inherited?: InheritedContext): void {
  // A realm is set up once; a child frame that already carries the runtime is left alone.
  if (Object.getOwnPropertyDescriptor(win, "__g$")) return;
  const ctx = createUrlContext(win, inherited);
  const nativeLocation = win.location;
  // Replaced by the real bridge once the cookies step runs; navigation reads it lazily.
  let cookies: CookieBridge = { currentSeq: () => 0, pendingWrites: () => null, applySync: () => {} };
  const fakeLocation = createFakeLocation(
    {
      real: () => ctx.realUrl(),
      navigate: (url, mode) => {
        const go = () => (mode === "replace" ? nativeLocation.replace(url) : nativeLocation.assign(url));
        // The next page must already see cookies this one has just written.
        const writes = cookies.pendingWrites();
        if (writes) void writes.then(go);
        else go();
      },
      reload: () => nativeLocation.reload(),
      setHash: (hash) => {
        nativeLocation.hash = hash;
      },
    },
    win.Location.prototype,
  );
  // Windows without a runtime of their own, such as blank frames and popups, still need a stand-in.
  const standIns = new WeakMap<object, object>();
  const standIn = (location: Location): object => {
    let fake = standIns.get(location);
    if (!fake) {
      fake = createFakeLocation(
        {
          real: () => realUrlOfLocation(location, ctx.origin) ?? ctx.realUrl(),
          navigate: (url, mode) => (mode === "replace" ? location.replace(url) : location.assign(url)),
          reload: () => location.reload(),
          setHash: (hash) => {
            location.hash = hash;
          },
        },
        win.Location.prototype,
      );
      standIns.set(location, fake);
    }
    return fake;
  };
  const rewrite = createRewriteBridge(ctx);
  const helpers = createHelpers({
    nativeLocation,
    fakeLocation,
    isLocation,
    fakeFor: (location) => fakeFor(win, location) ?? standIn(location as Location),
    isWindowOrDocument: (value) => {
      try {
        return typeof value === "object" && value !== null && "location" in value && isLocation(value.location);
      } catch {
        return false;
      }
    },
    toProxy: (raw) => ctx.toProxy(raw),
    rewrite,
    indirectEval: (code) => (0, win.eval)(code as string),
  });
  // Rewritten scripts call __g$, so it exists before anything else is attempted.
  Object.defineProperty(win, "__g$", { value: helpers, enumerable: false });

  const steps: Array<[string, () => void]> = [
    ["document", () => installDocument(win, ctx)],
    ["attributes", () => installAttributes(win, ctx)],
    ["html sinks", () => installHtmlSinks(win, (html) => helpers.H(html), rewrite.unhtml)],
    ["script exec", () => installScriptExec(win, rewrite.js, rewrite.jsBody)],
    ["workers", () => installWorkers(win, ctx)],
    ["cookies", () => (cookies = installCookies(win, ctx, config))],
    ["navigation", () => installNavigation(win, ctx, cookies)],
    ["service worker mask", () => installServiceWorkerMask(win)],
    // Before network so the shim captures the real fetch for its ws-prep RPC.
    ["websocket", () => installWebSocket(win, ctx)],
    ["network", () => installNetwork(win, ctx, cookies)],
    ["storage", () => installStorage(win, ctx)],
    ["storage isolation", () => installStorageIsolation(win, ctx)],
    ["messaging", () => installMessaging(win, ctx)],
    ["permissions", () => installPermissions(win)],
    ["masking", () => installMasking(win, ctx)],
    ["realtime", () => installRealtimeBlock(win)],
    ["frames", () => installFrames(win, ctx, config, install)],
    // Last, so every hook installed above is registered before tamper checks can read a masked toString.
    ["native mask", () => installToStringMask(win)],
  ];
  for (const [name, step] of steps) {
    try {
      step();
    } catch (error) {
      // One browser difference should cost one hook, not the whole page.
      console.warn("Girici:", name, error);
    }
  }
}

function isLocation(value: unknown): boolean {
  try {
    return Object.prototype.toString.call(value) === "[object Location]";
  } catch {
    return false;
  }
}

/** Other same-origin windows have their own runtime and stand-in, reached through their __g$. */
function fakeFor(win: Realm, location: object): object | null {
  const candidates: Array<Window | null> = [win.parent, win.top, win.opener as Window | null];
  for (let index = 0; index < win.frames.length; index++) candidates.push(win.frames[index] ?? null);
  for (const candidate of candidates) {
    try {
      if (candidate && candidate !== win && candidate.location === location) {
        const helpers = (candidate as unknown as { __g$?: { L(value: unknown): unknown } }).__g$;
        return helpers ? (helpers.L(location) as object) : null;
      }
    } catch {
      // Cross-origin windows throw on access and cannot be helped.
    }
  }
  return null;
}

function realUrlOfLocation(location: Location, origin: string): URL | null {
  try {
    const url = new URL(location.href);
    const real = url.origin === origin ? decodeUrl(url.pathname + url.search) : null;
    if (real) real.hash = url.hash;
    return real;
  } catch {
    // A cross-origin window hides its address; the caller falls back to this page's URL.
    return null;
  }
}
