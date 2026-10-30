import { decodeUrl } from "../shared/codec.ts";
import type { ClientConfig } from "../shared/protocol.ts";
import { UI_SETTINGS_KEY } from "../shared/ui-settings.ts";
import { installAttributes } from "./attributes.ts";
import { installCookies, type CookieBridge } from "./cookies.ts";
import { installDocument } from "./document.ts";
import { installFrames } from "./frames.ts";
import { createHelpers } from "./helpers.ts";
import { createInvoker, type Invoke } from "./invoke.ts";
import { createFakeLocation, type LocationEnv } from "./location.ts";
import { installHtmlSinks } from "./html-sinks.ts";
import { captureCurrentScript, DocumentSteps, engineScriptConfig, type DocumentListeners } from "./renewal.ts";
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
import { createMessageSender, installMessaging } from "./messaging.ts";
import { installPermissions } from "./permissions.ts";
import { installMasking } from "./masking.ts";
import { installServiceWorkerMask } from "./sw-mask.ts";
import { captureToolbarNatives, installToolbar, shouldShowToolbar } from "./toolbar.ts";
import { installTopSiteResponder } from "./top-site.ts";
import { createUrlContext, type Realm } from "./url-context.ts";

export function install(win: Realm, config: ClientConfig, clientUrl: string): void {
  const existing = Object.getOwnPropertyDescriptor(win, "__g$");
  if (existing) {
    // The browser reused this window for a new document, which renews the runtime from its own engine script.
    const helpers = existing.value as { renew?: unknown } | undefined;
    if (typeof helpers?.renew === "function") helpers.renew();
    return;
  }
  // Compiled before script exec replaces win.Function.
  const invoke = createInvoker(win);
  const ctx = createUrlContext(win, config.inherit);
  const currentScript = captureCurrentScript(win);
  const toolbarNatives = captureToolbarNatives(win);
  const container = serviceWorkerContainer(win);
  const nativeLocation = win.location;
  const ownLocation = locationCalls(nativeLocation, invoke);
  const steps = new DocumentSteps();
  const listeners: DocumentListeners[] = [];
  // Replaced by the real bridge once the cookies step runs; navigation reads it lazily.
  let cookies: CookieBridge = {
    currentSeq: () => 0,
    pendingWrites: () => null,
    applySync: () => {},
    reset: () => {},
    snapshot: () => [],
  };
  const fakeLocation = createFakeLocation(
    {
      real: () => ctx.realUrl(),
      navigate: (url, mode) => {
        // The next page must already see cookies this one has just written.
        const writes = cookies.pendingWrites();
        if (writes) void writes.then(() => ownLocation.navigate(url, mode));
        else ownLocation.navigate(url, mode);
      },
      reload: ownLocation.reload,
      setHash: ownLocation.setHash,
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
          ...locationCalls(location, invoke),
          real: () => realUrlOfLocation(location, ctx.origin) ?? ctx.realUrl(),
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
    messageTarget: createMessageSender(win, ctx, invoke),
    renew: () => {
      const next = engineScriptConfig(currentScript(), ctx.origin);
      if (!next) return false;
      steps.run(next);
      return true;
    },
  });
  // Rewritten scripts call __g$, so it exists before anything else is attempted.
  Object.defineProperty(win, "__g$", { value: helpers, enumerable: false });

  const installSteps: Array<[string, () => void]> = [
    ["document", () => installDocument(win, ctx)],
    ["attributes", () => installAttributes(win, ctx)],
    ["html sinks", () => installHtmlSinks(win, (html) => helpers.H(html), rewrite.unhtml)],
    ["script exec", () => installScriptExec(win, rewrite.js, rewrite.jsBody)],
    ["workers", () => installWorkers(win, ctx)],
    ["cookies", () => (cookies = installCookies(win, ctx, config))],
    ["navigation", () => listeners.push(installNavigation(win, ctx, cookies, invoke))],
    ["top site", () => listeners.push(installTopSiteResponder(win, container))],
    ["service worker mask", () => installServiceWorkerMask(win)],
    // Before network so the shim captures the real fetch for its ws-prep RPC.
    ["websocket", () => installWebSocket(win, ctx)],
    ["network", () => installNetwork(win, ctx, cookies)],
    ["storage", () => installStorage(win, ctx)],
    ["storage isolation", () => installStorageIsolation(win, ctx)],
    ["messaging", () => installMessaging(win, ctx, invoke)],
    ["permissions", () => installPermissions(win)],
    ["masking", () => installMasking(win, ctx)],
    ["realtime", () => installRealtimeBlock(win)],
    ["frames", () => installFrames(win, ctx, config, clientUrl, install)],
    // Last, so every hook installed above is registered before tamper checks can read a masked toString.
    ["native mask", () => installToStringMask(win)],
  ];
  for (const [name, step] of installSteps) {
    try {
      step();
    } catch (error) {
      // One browser difference should cost one hook, not the whole page.
      console.warn("Girici:", name, error);
    }
  }

  steps.add("cookies", (next) => cookies.reset(next));
  steps.add("context", (next) => ctx.inherit(next.inherit));
  steps.add("listeners", () => {
    for (const listener of listeners) listener.listen();
  });
  steps.add("toolbar", (next) => {
    const prefs = toolbarNatives.storage?.getItem(UI_SETTINGS_KEY) ?? null;
    if (!shouldShowToolbar({ isTop: toolbarNatives.isTop, inherited: next.inherit !== undefined, prefs })) return;
    installToolbar(win, ctx, toolbarNatives, {
      assign: (path) => ownLocation.navigate(new URL(path, ctx.origin).href, "assign"),
      reload: ownLocation.reload,
    });
  });
  steps.run(config);
}

/** Location calls take their source document from the calling realm, so they go through the invoker. */
function locationCalls(location: Location, invoke: Invoke): Pick<LocationEnv, "navigate" | "reload" | "setHash"> {
  return {
    navigate: (url, mode) => invoke(mode === "replace" ? location.replace : location.assign, location, [url]),
    reload: () => invoke(location.reload, location, []),
    setHash: (hash) => {
      // Location members are own properties of each instance, not of Location.prototype.
      const set = Object.getOwnPropertyDescriptor(location, "hash")?.set;
      if (set) invoke(set, location, [hash]);
      else location.hash = hash;
    },
  };
}

/** Taken before the service worker mask hides the real container from the page. */
function serviceWorkerContainer(win: Realm): ServiceWorkerContainer | null {
  try {
    return (win.navigator.serviceWorker as ServiceWorkerContainer | undefined) ?? null;
  } catch {
    // Some engines throw here for an opaque origin; such a frame has no worker to answer.
    return null;
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
