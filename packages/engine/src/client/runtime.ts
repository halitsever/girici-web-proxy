import { clientTag } from "../shared/client-tag.ts";
import { append, define, hrefOf, isWebUrl, NativeWeakMap, newUrl, originOf } from "../shared/primordials.ts";
import type { ClientConfig } from "../shared/protocol.ts";
import type { OpenSealed } from "../shared/sealed-address.ts";
import { readToolbarPrefs, UI_SETTINGS_KEY } from "../shared/ui-settings.ts";
import { installAttributes } from "./attributes.ts";
import { installBlobDocuments, isBlobUrl } from "./blob-documents.ts";
import { installCookies, type CookieBridge } from "./cookies.ts";
import { installDocument } from "./document.ts";
import { createChildConfig, installFrames, type FrameAdopter } from "./frames.ts";
import { createHelpers, type HelperEnv } from "./helpers.ts";
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
import { captureAncestors, framePartitionTop, installStorage, partitionFor } from "./storage.ts";
import { installStorageIsolation } from "./storage-isolation.ts";
import { createMessageSender, installMessaging } from "./messaging.ts";
import { createSiteMessaging, type LabelLookup } from "./site-messages.ts";
import { installPermissions } from "./permissions.ts";
import { installMasking } from "./masking.ts";
import { installServiceWorkerMask } from "./sw-mask.ts";
import { captureToolbarNatives, createToolbarKeys, installToolbar, shouldShowToolbar, toolbarHome } from "./toolbar.ts";
import { installTopSiteResponder } from "./top-site.ts";
import { createUrlContext, engineSiteOf, realOriginOf, realUrlOf, type Realm } from "./url-context.ts";
import { createWindowGuard, installWindowLinks } from "./windows.ts";

// Taken at load: install also runs when a page inserts a frame, after page code may have replaced these.
const apply = Reflect.apply;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const warn = console.warn;
const nativeConsole = console;
const freeze = Object.freeze;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;

/**
 * `announce` is the worker announcer of the window this one inherits from: a blank window's own client has no page
 * address for the service worker to bind its workers to. `lookup`, that window's site host lookup, stands in for the
 * same reason. `navigating` marks a blank popup already headed elsewhere.
 */
export function install(
  win: Realm,
  config: ClientConfig,
  clientUrl: string,
  announce?: Announce,
  navigating = false,
  lookup?: LabelLookup,
): void {
  const existing = ownDescriptor(win, "__g$");
  if (existing) {
    // The browser reused this window for a new document, which renews the runtime from its own engine script. A
    // renewal keeps the origin the window was given first, and other sites reach the window only through a wrapper.
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
  const ctx = createUrlContext(win, config.inherit, config.seal);
  const blobs = installBlobDocuments(
    win,
    ctx,
    (inherit) => clientTag(clientUrl, { __proto__: null, ...childConfig(), inherit } as ClientConfig),
    invoke,
  );
  // A window keeps its host, so the first document's site context holds for every document it renews to.
  const sites = config.sites;
  // Takes the window's own fetch, postMessage and setTimeout, before any hook replaces them.
  const siteMessaging = createSiteMessaging(win, ctx, invoke, sites, () => (current.inherit ? lookup : undefined));
  // Before the messaging and window hooks, whose natives it takes.
  const guard = createWindowGuard(win, ctx, invoke, blobs.swap, siteMessaging?.post);
  const currentScript = captureCurrentScript(win);
  const toolbarNatives = captureToolbarNatives(win);
  const ancestors = captureAncestors(win);
  const readContainer = serviceWorkerContainer(win);
  // Chromium gives the page that reuses a blank window the container the blank document read, without a controller,
  // so a window already headed for another page waits for that page before reading it.
  let awaiting = navigating || headedElsewhere(win, config.inherit?.origin ?? win.location.origin);
  const container = () => (awaiting ? null : readContainer());
  const nativeLocation = win.location;
  const isLocation = locationCheck(nativeLocation);
  const ownLocation = locationCalls(nativeLocation, invoke, blobs.swap);
  const steps = new DocumentSteps();
  if (awaiting) {
    const blank = win.document;
    // A page that never arrives leaves the blank document in place; from its load on it listens like any other.
    const lift = () => {
      if (!awaiting || win.document !== blank) return;
      awaiting = false;
      steps.again(["listeners"]);
    };
    apply(win.EventTarget.prototype.addEventListener, win, ["load", lift, { __proto__: null, once: true }]);
  }
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
  // Env and option objects below have null prototypes and every member own, so none is read from the page's prototypes.
  const fakeLocation = createFakeLocation(
    {
      __proto__: null,
      real: () => ctx.realUrl(),
      navigate: (url, mode) => {
        // The next page must already see cookies this one has just written.
        const writes = cookies.pendingWrites();
        if (writes) void writes.then(() => ownLocation.navigate(url, mode));
        else ownLocation.navigate(url, mode);
      },
      reload: ownLocation.reload,
      setHash: ownLocation.setHash,
      owner: () => originOf(ctx.realUrl()),
      address: ctx.documentAddress,
    } as LocationEnv,
    win.Location.prototype,
  );
  // Windows without a runtime of their own, such as blank frames and popups, still need a stand-in.
  const standIns = new NativeWeakMap<object, object>();
  const standIn = (location: Location): object => {
    let fake = apply(mapGet, standIns, [location]) as object | undefined;
    if (!fake) {
      const calls = locationCalls(location, invoke, blobs.swap);
      fake = createFakeLocation(
        {
          __proto__: null,
          navigate: calls.navigate,
          reload: calls.reload,
          setHash: calls.setHash,
          real: () => realUrlOfLocation(location, ctx.origin, ctx.openSealed) ?? ctx.realUrl(),
          // The caller is this realm, whichever window the stand-in navigates.
          owner: () => originOf(ctx.realUrl()),
        } as LocationEnv,
        win.Location.prototype,
      );
      apply(mapSet, standIns, [location, fake]);
    }
    return fake;
  };
  const rewrite = createRewriteBridge(
    ctx,
    (base) => {
      const child = childConfig();
      const inherit = { __proto__: null, origin: ctx.origin, base: hrefOf(base) };
      return clientTag(clientUrl, { __proto__: null, ...child, inherit } as ClientConfig);
    },
    blobs,
  );
  const partition = () => {
    // top cannot be redefined by a page, and neither can the address read from it.
    const top = win.top;
    const topOrigin = top === win ? null : realOriginOf(top, ctx.origin);
    const siteMode = sites !== undefined && top !== win && !topOrigin;
    return partitionFor({
      __proto__: null,
      origin: originOf(ctx.realUrl()),
      isTop: top === win,
      topUrl: framePartitionTop({
        __proto__: null,
        topOrigin,
        ancestors: siteMode ? ancestors() : null,
        siteMode,
      } as Parameters<typeof framePartitionTop>[0]),
      site: current.site,
      topSite: top === win ? undefined : engineSiteOf(top),
    } as Parameters<typeof partitionFor>[0]);
  };
  const helpers = createHelpers({
    __proto__: null,
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
    navigationUrl: (raw) => blobs.swap(ctx.toProxy(raw)),
    rewrite,
    indirectEval: (code) => (0, win.eval)(code as string),
    messageTarget: createMessageSender(win, ctx, invoke, guard.isWrapper, siteMessaging?.post),
    wrapWindow: guard.wrap,
    realOrigin: () => originOf(ctx.realUrl()),
    site: () => current.site,
    renew: createRenew(currentScript, ctx.origin, steps, (next) => ctx.accepts(next.inherit, next.seal)),
  } as HelperEnv);
  // Rewritten scripts call __g$, so it exists before anything else is attempted. Frozen so no page swaps a helper.
  define(win, "__g$", { value: freeze(helpers), enumerable: false });

  const childConfig = createChildConfig(ctx, () => cookies.snapshot(), steps, config);

  const installSteps: Array<[string, () => void]> = [
    ["document", () => (resetDomain = installDocument(win, ctx, sites))],
    // Early, so the window.open it wraps is still the browser's and the HTML sinks below can reach it.
    [
      "frames",
      () =>
        (frames = installFrames(
          win,
          ctx,
          childConfig,
          (child, next, url, navigating) => install(child, next, url, ownAnnounce, navigating, siteMessaging?.lookup),
          clientUrl,
          steps,
          guard,
        )),
    ],
    [
      "attributes",
      () => {
        const attributes = installAttributes(win, ctx, rewrite, blobs);
        frames?.useBackstop(attributes.normalize);
      },
    ],
    [
      "html sinks",
      () =>
        installHtmlSinks(
          win,
          (html) => helpers.H(html),
          rewrite.unhtml,
          (at) => frames?.walkFor(at),
          (doc) => frames?.reopened(doc),
        ),
    ],
    ["script exec", () => installScriptExec(win, rewrite.js, rewrite.jsBody)],
    ["workers", () => installWorkers(win, ctx, partition, ownAnnounce)],
    ["cookies", () => append(listeners, (cookies = installCookies(win, ctx, config, container, ownLocation.reload)))],
    [
      "navigation",
      () => {
        const navigation = installNavigation(win, ctx, cookies, invoke, guard, blobs);
        append(listeners, navigation);
        frames?.useOpen(navigation.open);
      },
    ],
    ["top site", () => append(listeners, installTopSiteResponder(win, container))],
    ["service worker mask", () => installServiceWorkerMask(win)],
    // Before network so the shim captures the real fetch for its ws-prep RPC.
    ["websocket", () => installWebSocket(win, ctx)],
    ["network", () => installNetwork(win, ctx, cookies)],
    ["storage", () => append(listeners, installStorage(win, partition))],
    ["storage isolation", () => installStorageIsolation(win, ctx, partition)],
    [
      "messaging",
      () => {
        const screen = installMessaging(win, ctx, invoke, guard, siteMessaging?.labels);
        if (screen) append(listeners, screen);
      },
    ],
    ["windows", () => installWindowLinks(win, ctx, guard)],
    ["permissions", () => installPermissions(win)],
    ["masking", () => installMasking(win, ctx)],
    ["realtime", () => installRealtimeBlock(win)],
    // Last, so every hook installed above is registered before tamper checks can read a masked toString.
    ["native mask", () => installToStringMask(win)],
  ];
  // Indexed, without destructuring: adopting a frame runs this inside a page call, after the page may have replaced
  // the array iterator.
  for (let index = 0; index < installSteps.length; index++) {
    const entry = installSteps[index] as [string, () => void];
    try {
      entry[1]();
    } catch (error) {
      // One browser difference should cost one hook, not the whole page.
      apply(warn, nativeConsole, ["Girici:", entry[0], error]);
    }
  }

  steps.add("config", (next) => {
    awaiting &&= next === config;
    current = next;
    inheritedAnnounce = next.inherit ? announce : undefined;
  });
  steps.add("document", () => resetDomain());
  steps.add("cookies", (next) => cookies.reset(next));
  steps.add("context", (next) => ctx.inherit(next.inherit, next.seal));
  // The document may be of another site now, so windows handed out as is to the last one are judged again.
  steps.add("site", () => guard.reset());
  steps.add("listeners", () => {
    // Runs again after document.open, inside a page call, so it reads the list by index.
    for (let index = 0; index < listeners.length; index++) (listeners[index] as DocumentListeners).listen();
  });
  steps.add("toolbar", (next) => {
    toolbarKeys.use(null);
    // A site host's storage is the site's own, so its settings come from the worker instead.
    const prefs = sites ? null : (toolbarNatives.storage?.getItem(UI_SETTINGS_KEY) ?? null);
    const show = {
      __proto__: null,
      isTop: toolbarNatives.isTop,
      inherited: next.inherit !== undefined,
      prefs,
      site: sites,
    };
    if (!shouldShowToolbar(show as Parameters<typeof shouldShowToolbar>[0])) return;
    installToolbar(
      win,
      ctx,
      toolbarNatives,
      {
        __proto__: null,
        assign: (path: string) => ownLocation.navigate(hrefOf(newUrl(path, ctx.origin)), "assign"),
        reload: ownLocation.reload,
      } as Parameters<typeof installToolbar>[3],
      toolbarKeys,
      {
        __proto__: null,
        home: toolbarHome(ctx.origin, sites),
        engine: sites ? sites.engine : readToolbarPrefs(prefs).engine,
      } as Parameters<typeof installToolbar>[5],
    );
  });
  steps.add("blob document", (next) => {
    const blob = next.inherit?.blob;
    if (typeof blob === "string" && isBlobUrl(blob)) void blobs.load(blob);
  });
  steps.run(config);
}

/** Location calls take their source document from the calling realm, so they go through the invoker. */
function locationCalls(
  location: Location,
  invoke: Invoke,
  swapBlob: (url: string) => string,
): Pick<LocationEnv, "navigate" | "reload" | "setHash"> {
  return {
    __proto__: null,
    navigate: (url, mode) => invoke(mode === "replace" ? location.replace : location.assign, location, [swapBlob(url)]),
    reload: () => invoke(location.reload, location, []),
    setHash: (hash) => {
      // Location members are own properties of each instance, not of Location.prototype.
      const set = ownDescriptor(location, "hash")?.set;
      if (set) invoke(set, location, [hash]);
      else location.hash = hash;
    },
  } as Pick<LocationEnv, "navigate" | "reload" | "setHash">;
}

/** A blank frame whose element names a web page to load: the browser will reuse this window for that page. */
function headedElsewhere(win: Realm, origin: string): boolean {
  try {
    if (win.location.href !== "about:blank") return false;
    const frame = ownDescriptor(win, "frameElement")?.get;
    const element = frame ? (apply(frame, win, []) as Element | null) : null;
    if (!element) return false;
    const getAttribute = win.Element.prototype.getAttribute;
    const src = apply(getAttribute, element, ["src"]) as string | null;
    if (!src || apply(getAttribute, element, ["srcdoc"]) !== null) return false;
    return isWebUrl(newUrl(src, origin));
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

/**
 * A Location's own href getter throws for anything that is not a Location. `@@toStringTag` would not do: a page can
 * delete it from Location.prototype.
 */
export function locationCheck(location: object): (value: unknown) => boolean {
  const href = ownDescriptor(location, "href")?.get;
  return (value) => {
    if (typeof value !== "object" || value === null || !href) return false;
    try {
      apply(href, value, []);
      return true;
    } catch {
      return false;
    }
  };
}

/** Other same-origin windows have their own runtime and stand-in, reached through their __g$. */
function fakeFor(win: Realm, location: object): object | null {
  const candidates: Array<Window | null> = [win.parent, win.top, win.opener as Window | null];
  for (let index = 0; index < win.frames.length; index++) append(candidates, win.frames[index] ?? null);
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
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

/** A sealed address opens here only when it is this page's own origin, which its seal covers. */
function realUrlOfLocation(location: Location, origin: string, open: OpenSealed): URL | null {
  try {
    return realUrlOf(location.href, origin, open);
  } catch {
    // A cross-origin window hides its address; the caller falls back to this page's URL.
    return null;
  }
}
