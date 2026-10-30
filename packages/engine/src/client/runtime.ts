import { clientTag } from "../shared/client-tag.ts";
import { decodeUrl } from "../shared/codec.ts";
import { prefixFor } from "../shared/partition.ts";
import { PROTOCOL_VERSION, type ClientConfig } from "../shared/protocol.ts";
import { UI_SETTINGS_KEY } from "../shared/ui-settings.ts";
import { installAttributes } from "./attributes.ts";
import { installCookies, type CookieBridge } from "./cookies.ts";
import { installDocument } from "./document.ts";
import { installFrames, type FrameAdopter } from "./frames.ts";
import { createHelpers } from "./helpers.ts";
import { createInvoker, type Invoke } from "./invoke.ts";
import { createFakeLocation, type LocationEnv } from "./location.ts";
import { installHtmlSinks } from "./html-sinks.ts";
import { captureCurrentScript, createRenew, DocumentSteps, renewExisting, type DocumentListeners } from "./renewal.ts";
import { createRewriteBridge } from "./rewrite-bridge.ts";
import { installScriptExec } from "./script-exec.ts";
import { installToStringMask } from "./native-mask.ts";
import { installWorkers, type Announce } from "./workers.ts";
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
import { captureToolbarNatives, createToolbarKeys, installToolbar, shouldShowToolbar } from "./toolbar.ts";
import { installTopSiteResponder } from "./top-site.ts";
import { createUrlContext, type Realm } from "./url-context.ts";

// Taken at load: install also runs when a page inserts a frame, after page code may have replaced these.
const apply = Reflect.apply;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;

/**
 * `announce` is the worker announcer of the window this one inherits from: a blank window's own client has no page
 * address for the service worker to bind its workers to. `navigating` marks a blank popup already headed elsewhere.
 */
export function install(
  win: Realm,
  config: ClientConfig,
  clientUrl: string,
  announce?: Announce,
  navigating = false,
): void {
  const existing = ownDescriptor(win, "__g$");
  if (existing) {
    // The browser reused this window for a new document, which renews the runtime from its own engine script. This
    // holds across sites too: whoever could script the blank window can script the page that reuses it until windows
    // of other sites are wrapped, so refusing would only cost every such frame a second load.
    renewExisting(existing.value, () => {
      const location = win.location;
      apply(location.reload, location, []);
    });
    return;
  }
  // Compiled before script exec replaces win.Function.
  const invoke = createInvoker(win);
  // Taken before the network hooks wrap it.
  const nativeFetch = win.fetch;
  const ctx = createUrlContext(win, config.inherit);
  const currentScript = captureCurrentScript(win);
  const toolbarNatives = captureToolbarNatives(win);
  const readContainer = serviceWorkerContainer(win);
  // Chromium gives the page that reuses a blank window the container the blank document read, without a controller,
  // so a window already headed for another page waits for that page before reading it.
  let awaiting = navigating || headedElsewhere(win);
  const container = () => (awaiting ? null : readContainer());
  const nativeLocation = win.location;
  const ownLocation = locationCalls(nativeLocation, invoke);
  const steps = new DocumentSteps();
  const toolbarKeys = createToolbarKeys(win);
  const listeners: DocumentListeners[] = [toolbarKeys];
  let current = config;
  // Only a document that inherits a page announces through that page; a proxied page has its own address.
  let inheritedAnnounce = config.inherit ? announce : undefined;
  const ownAnnounce: Announce = (url, init) =>
    inheritedAnnounce ? inheritedAnnounce(url, init) : apply(nativeFetch, win, [url, init]);
  let frames: FrameAdopter | null = null;
  let resetDomain = () => {};
  // Replaced by the real bridge once the cookies step runs; navigation reads it lazily.
  let cookies: CookieBridge = {
    listen: () => {},
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
  const rewrite = createRewriteBridge(ctx, () => clientTag(clientUrl, childConfig()));
  const partition = () => prefixFor(ctx.realUrl().origin);
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
    renew: createRenew(currentScript, ctx.origin, steps),
  });
  // Rewritten scripts call __g$, so it exists before anything else is attempted. Frozen so no page swaps a helper.
  defineProperty(win, "__g$", { value: freeze(helpers), enumerable: false });

  const childConfig = (): ClientConfig => {
    const child: ClientConfig = {
      v: PROTOCOL_VERSION,
      cookies: cookies.snapshot(),
      inherit: { origin: ctx.origin, base: ctx.realUrl().href },
    };
    if (current.cookiesBlocked !== undefined) child.cookiesBlocked = current.cookiesBlocked;
    if (current.site !== undefined) child.site = current.site;
    return child;
  };

  const installSteps: Array<[string, () => void]> = [
    ["document", () => (resetDomain = installDocument(win, ctx))],
    // Early, so the window.open it wraps is still the browser's and the HTML sinks below can reach it.
    [
      "frames",
      () =>
        (frames = installFrames(
          win,
          ctx,
          childConfig,
          (child, next, url, navigating) => install(child, next, url, ownAnnounce, navigating),
          clientUrl,
          steps,
        )),
    ],
    ["attributes", () => installAttributes(win, ctx, rewrite)],
    [
      "html sinks",
      () =>
        installHtmlSinks(
          win,
          (html) => helpers.H(html),
          rewrite.unhtml,
          (at) => frames?.walkFor(at),
        ),
    ],
    ["script exec", () => installScriptExec(win, rewrite.js, rewrite.jsBody)],
    ["workers", () => installWorkers(win, ctx, partition, ownAnnounce)],
    ["cookies", () => listeners.push((cookies = installCookies(win, ctx, config, container, ownLocation.reload)))],
    ["navigation", () => listeners.push(installNavigation(win, ctx, cookies, invoke))],
    ["top site", () => listeners.push(installTopSiteResponder(win, container))],
    ["service worker mask", () => installServiceWorkerMask(win)],
    // Before network so the shim captures the real fetch for its ws-prep RPC.
    ["websocket", () => installWebSocket(win, ctx)],
    ["network", () => installNetwork(win, ctx, cookies)],
    ["storage", () => installStorage(win, ctx)],
    ["storage isolation", () => installStorageIsolation(win, ctx, partition)],
    ["messaging", () => installMessaging(win, ctx, invoke)],
    ["permissions", () => installPermissions(win)],
    ["masking", () => installMasking(win, ctx)],
    ["realtime", () => installRealtimeBlock(win)],
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

  steps.add("config", (next) => {
    awaiting &&= next === config;
    current = next;
    inheritedAnnounce = next.inherit ? announce : undefined;
  });
  steps.add("document", () => resetDomain());
  steps.add("cookies", (next) => cookies.reset(next));
  steps.add("context", (next) => ctx.inherit(next.inherit));
  steps.add("listeners", () => {
    for (const listener of listeners) listener.listen();
  });
  steps.add("toolbar", (next) => {
    toolbarKeys.use(null);
    const prefs = toolbarNatives.storage?.getItem(UI_SETTINGS_KEY) ?? null;
    if (!shouldShowToolbar({ isTop: toolbarNatives.isTop, inherited: next.inherit !== undefined, prefs })) return;
    installToolbar(
      win,
      ctx,
      toolbarNatives,
      {
        assign: (path) => ownLocation.navigate(new URL(path, ctx.origin).href, "assign"),
        reload: ownLocation.reload,
      },
      toolbarKeys,
    );
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

/** A blank frame whose element names a page to load: the browser will reuse this window for that page. */
function headedElsewhere(win: Realm): boolean {
  try {
    if (win.location.href !== "about:blank") return false;
    const frame = ownDescriptor(win, "frameElement")?.get;
    const element = frame ? (apply(frame, win, []) as Element | null) : null;
    if (!element) return false;
    const getAttribute = win.Element.prototype.getAttribute;
    const src = apply(getAttribute, element, ["src"]) as string | null;
    return !!src && src !== "about:blank" && apply(getAttribute, element, ["srcdoc"]) === null;
  } catch {
    return false;
  }
}

/**
 * The getters are taken before the service worker mask hides the real container. Read again for each document,
 * since WebKit gives the page that reuses a window a container of its own.
 */
function serviceWorkerContainer(win: Realm): () => ServiceWorkerContainer | null {
  const navigatorOf = ownDescriptor(win, "navigator")?.get;
  const containerOf = win.Navigator ? ownDescriptor(win.Navigator.prototype, "serviceWorker")?.get : undefined;
  return () => {
    try {
      if (!navigatorOf || !containerOf) return null;
      return (apply(containerOf, apply(navigatorOf, win, []), []) as ServiceWorkerContainer | undefined) ?? null;
    } catch {
      // Some engines throw here for an opaque origin; such a frame has no worker to answer.
      return null;
    }
  };
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
