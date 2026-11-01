import {
  CONTINUE_PATH,
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  HEADER,
  LABEL_RPC_PATH,
  LOGIN_PATH,
  POT_PATH,
  PROTOCOL_VERSION,
  SITE_DATA_RPC_PATH,
  SITES_CONFIG_PATH,
  TOP_SITE_QUERY,
  WORKER_RPC_PATH,
  WS_PREP_PATH,
  WS_SEAL_PATH,
  type CookieSnapshot,
} from "../shared/protocol.ts";
import { createIdbClientRecords } from "./client-records.ts";
import { cookieDeliveries } from "./cookie-broadcast.ts";
import { createIdbCookieStore } from "./cookies/idb-store.ts";
import { CookieService, type CookieRequestContext } from "./cookies/jar.ts";
import { DeepLinkWarning } from "./deep-link-warning.ts";
import { errorResponse, forbiddenResponse, type ErrorPageCode } from "./error-page.ts";
import { InstanceState } from "./instance-state.ts";
import { buildPageResponse } from "./page-response.ts";
import { createIdbPrefsStore, PrefsService, readPrefsMessage } from "./prefs.ts";
import { createIdbKeyStore, readSealMessage, Sealing } from "./sealing.ts";
import { isSealedPath } from "../shared/sealed-address.ts";
import { labelSiteOf } from "../shared/label-site.ts";
import { navigationInitiator } from "./initiator.ts";
import { handleLabelRpc } from "./label-rpc.ts";
import { resubmitResponse } from "./resubmit.ts";
import {
  classifyRequest,
  isGuardedPath,
  isNetworkInEitherMode,
  isHostReservedPath,
  realUrlOf,
  requestClientUrl,
  reservedAccess,
  type Route,
  type SiteRouting,
} from "./route.ts";
import { CookieRpc } from "./rpc.ts";
import { callerOf, handleSiteData } from "./site-data.ts";
import { createIdbSiteStore, SiteModeService } from "./site-mode.ts";
import { FrameTops, isThirdParty, topSiteFor, windowTop, type TopSiteDeps } from "./third-party.ts";
import { RuntimeStore, sha256Hex } from "./runtime-store.ts";
import { HttpRelayTransport } from "./transport.ts";
import { loadsUi, UiClients } from "./ui-clients.ts";
import { buildWsPrep, sealWsPrep } from "./ws-prep.ts";
import { answerAnnouncement, readNonce, WorkerRegistry, type WorkerIdentity } from "./worker-identity.ts";
import { isYtPlayer, spliceDirectStreams } from "./yt-extract.ts";

declare const self: ServiceWorkerGlobalScope;
declare const __GIRICI_CLIENT__: string;
declare const __GIRICI_WORKER__: string;
declare const __GIRICI_CLIENT_SHA256__: string;
declare const __GIRICI_WORKER_SHA256__: string;

const CLIENT_PATH = __GIRICI_CLIENT__;
const WORKER_PATH = __GIRICI_WORKER__;
// Each worker keeps the runtime it was built with, so a server update cannot hand old workers a mismatched one.
const CLIENT_CACHE = `girici:${CLIENT_PATH}`;
const runtime = new RuntimeStore(
  [
    { path: CLIENT_PATH, sha256: __GIRICI_CLIENT_SHA256__ },
    { path: WORKER_PATH, sha256: __GIRICI_WORKER_SHA256__ },
  ],
  {
    open: () => caches.open(CLIENT_CACHE),
    // The cache mode skips the HTTP cache, so a stale or altered copy there cannot pass for the runtime.
    fetch: (path) => fetch(path, { cache: "reload" }),
    digest: sha256Hex,
  },
);
const transport = new HttpRelayTransport();
// Window clients answer at once; only a deadlocked worker ever reaches this.
const CLIENT_LOOKUP_TIMEOUT = 200;
// A frame whose runtime has not started yet cannot answer; its request then counts as third-party.
const TOP_QUERY_TIMEOUT = 200;
const cookies = new CookieService(createIdbCookieStore());
const rpc = new CookieRpc(cookies);
const prefs = new PrefsService(createIdbPrefsStore());
const sealing = new Sealing(createIdbKeyStore(), prefs);
const instance = new InstanceState(() => fetch(`${self.location.origin}/_g/auth/state`, { cache: "no-store" }), prefs);
const warning = new DeepLinkWarning({
  prefs,
  // Only the root answers /_g/auth/state, so a site host hears the switch with its config.
  instance: {
    deepLinkWarning: async () =>
      siteMode.settled() === "site" ? (siteMode.state()?.deepLinkWarning ?? true) : instance.deepLinkWarning(),
  },
  keys: createIdbKeyStore("warning"),
});
const clientRecords = createIdbClientRecords();
const ui = new UiClients(clientRecords, {
  liveIds: async () =>
    new Set((await self.clients.matchAll({ type: "window", includeUncontrolled: true })).map((client) => client.id)),
});
const workers = new WorkerRegistry(clientRecords);
// A UI tab can message the worker before the activation that records it has finished.
let seeding: Promise<void> = Promise.resolve();
const topSiteDeps: TopSiteDeps = {
  frames: new FrameTops(),
  origin: self.location.origin,
  windowClients: () => self.clients.matchAll({ type: "window" }),
  askTop,
  workers: (clientId) => workers.identityOf(clientId),
  open: sealing.open,
};
// Tabs of the same site keep their document.cookie mirrors current through these messages.
// One chain keeps deliveries in write order.
let announced: Promise<void> = Promise.resolve();
cookies.onChange((changes) => {
  announced = announced.then(() => announceCookies(changes)).catch(() => {});
});

// In subdomain mode the root's settings arrive with this host's config instead of from a UI tab.
const siteMode = new SiteModeService({
  fetch: (init) => fetch(`${self.location.origin}${SITES_CONFIG_PATH}`, init),
  store: createIdbSiteStore(),
  protocol: self.location.protocol,
  host: self.location.host,
  apply: (state) =>
    prefs.set({
      blockThirdPartyCookies: state.prefs.blockThirdPartyCookies,
      sealAddresses: state.prefs.sealAddresses,
      instanceSeal: state.instanceSeal,
    }),
});

self.addEventListener("install", (event) => {
  // A network error fails the install so the browser tries again, rather than guessing the mode.
  event.waitUntil(Promise.all([runtime.install(), siteMode.refresh(true)]).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // A site host has no UI tabs to record, and its instance switches come with its config.
  seeding = inSingleMode(() => {
    const seeded = seedUiClients();
    instance.refresh(true);
    return seeded;
  });
  const cleanup = caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith("girici:") && key !== CLIENT_CACHE).map((key) => caches.delete(key)),
      ),
    );
  // UI tabs are recorded before claim() hands them to this worker.
  event.waitUntil(Promise.all([cleanup, seeding]).then(() => self.clients.claim()));
});

async function seedUiClients(): Promise<void> {
  try {
    await ui.ready();
    await ui.seedOnce(await self.clients.matchAll({ type: "window", includeUncontrolled: true }), self.location.origin);
  } catch {
    // An unseeded tab gains UI authority on its next load.
  }
}

async function uiReady(): Promise<void> {
  await Promise.all([ui.ready(), seeding]);
}

/** Runs `work` only in single-origin mode: at once when the mode is known, as it always is off a site host. */
function inSingleMode(work: () => Promise<void>): Promise<void> {
  if (siteMode.settled() === "single") return work();
  return siteMode.ready().then(
    () => (siteMode.settled() === "single" ? work() : undefined),
    () => undefined,
  );
}

self.addEventListener("message", (event) => {
  // The bootstrap page asks for control at once instead of waiting for the next navigation.
  if ((event.data as { type?: unknown } | null)?.type === "girici:claim") {
    event.waitUntil(self.clients.claim());
    return;
  }
  const answer = event.ports[0];
  // A site host has no UI, so nothing there may change the settings or ask for a sealed address.
  event.waitUntil(
    inSingleMode(() =>
      uiReady().then(async () => {
        const sealRequest = readSealMessage(event.data, event.source as Client | null, self.location.origin, ui);
        if (sealRequest !== null) {
          answer?.postMessage({ path: await sealing.addressFor(sealRequest).catch(() => null) });
          return;
        }
        const update = readPrefsMessage(event.data, event.source as Client | null, self.location.origin, ui);
        if (!update) return;
        await prefs.set(update);
        // The UI cannot turn the admin's switch off, only have the worker ask the server again.
        if ((event.data as { instanceSeal?: unknown }).instanceSeal === false) instance.refresh(true);
        // The UI waits for this answer before navigating, so the next page already sees the new choice.
        answer?.postMessage({ ok: true });
      }),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const mode = siteMode.settled();
  if (mode !== null) {
    const answer = respond(event, mode === "site");
    if (answer) event.respondWith(answer);
    return;
  }
  if (isNetworkInEitherMode(new URL(event.request.url), self.location.origin)) return;
  // A worker restarted on a site host reads its stored mode before it routes anything.
  event.respondWith(
    siteMode.ready().then(
      () => respond(event, siteMode.settled() === "site") ?? fetch(event.request),
      () => (event.request.mode === "navigate" ? htmlError("connect", 502, null) : Response.error()),
    ),
  );
});

/** The worker's answer to a request, or null to leave it to the browser. */
function respond(event: FetchEvent, site: boolean): Promise<Response> | null {
  const url = new URL(event.request.url);
  const origin = self.location.origin;
  if (loadsUi(event.request, url, origin, site)) {
    if (event.resultingClientId) ui.add(event.resultingClientId);
    // Answering keeps the page controlled under this ID, which Playwright's Firefox loses when a navigation falls
    // back. Once the worker answers, a server that is down gets Girici's error page instead of the browser's.
    return fetch(event.request).catch(() => htmlError("connect", 502, url));
  }
  const own = url.origin === origin;
  // The query is ignored for serving: a worker's import carries the nonce its page announced.
  if (own && runtime.has(url.pathname)) {
    const nonce = readNonce(url);
    if (nonce && event.clientId) event.waitUntil(workers.claim(event.clientId, nonce));
    return runtime.response(url.pathname);
  }
  const post = event.request.method === "POST";
  if (own && url.pathname === WORKER_RPC_PATH && post) return handleWorkerRpc(event);
  if (own && url.pathname === COOKIE_RPC_PATH && post) return handleCookieRpc(event);
  if (own && url.pathname === WS_PREP_PATH && post) return handleWsPrep(event);
  if (own && url.pathname === SITE_DATA_RPC_PATH && post) return handleSiteDataRpc(event, site);
  if (site && own && url.pathname === LABEL_RPC_PATH && post) {
    return handleLabelRpc(event.request, (target) => siteMode.hostOf(target));
  }
  if (own && url.pathname === CONTINUE_PATH) {
    return sealing.ready().then(() => warning.accept(event.request, sealing.open, origin));
  }
  if (own && isGuardedPath(url.pathname)) {
    if (event.request.mode === "navigate") {
      // A navigation has no client yet, so only its shape is judged.
      const denied = reservedAccess(url.pathname, event.request, undefined, origin, ui, site) === "deny";
      return denied ? Promise.resolve(forbiddenResponse()) : null;
    }
    return guardReserved(event, url.pathname, site);
  }
  if (own && isHostReservedPath(url.pathname, site)) return null;
  return handle(event, site);
}

async function announceCookies(changes: CookieSnapshot[]): Promise<void> {
  const [clients] = await Promise.all([self.clients.matchAll({ type: "window" }), sealing.ready()]);
  for (const delivery of cookieDeliveries(clients, changes, self.location.origin, sealing.open)) {
    delivery.client.postMessage({
      type: COOKIE_MESSAGE,
      v: PROTOCOL_VERSION,
      changes: delivery.changes,
    });
  }
}

/** A client that cannot be looked up in time counts as a page, not as the UI. */
async function guardReserved(event: FetchEvent, pathname: string, site: boolean): Promise<Response> {
  const [client] = await Promise.all([clientOf(event), uiReady()]);
  const decision = reservedAccess(pathname, event.request, client, self.location.origin, ui, site);
  return decision === "allow" ? fetch(event.request) : forbiddenResponse();
}

async function handle(event: FetchEvent, site: boolean): Promise<Response> {
  const { request } = event;
  const origin = self.location.origin;
  const navigation = request.mode === "navigate";
  const client = await clientOf(event);
  const referrer = request.referrer || null;
  // A worker stuck in importScripts cannot be looked up, but its binding is known by its client ID.
  const identity = await identityOf(event, client);
  const clientUrl = requestClientUrl({ client, identity }, origin);
  const topLevelGet = navigation && request.destination === "document" && request.method === "GET";
  if (topLevelGet && !site) instance.refresh();
  // Fresh settings reach an open site on its next page load, read beside the page itself.
  const pageConfig = site && topLevelGet ? siteMode.forPage() : undefined;
  // A navigation needs the label key to tell which host its target lives on.
  if (site && navigation) await siteMode.ensureKey();
  await Promise.all([cookies.ready(), sealing.ready()]);
  const master = await sealing.sealerFor(isSealedPath(new URL(request.url).pathname));
  let route: Route;
  try {
    route = classifyRequest({
      url: request.url,
      origin,
      navigation,
      clientUrl,
      referrer,
      topLevelGet,
      open: sealing.open,
      seal: master ? (url) => master.seal(url) : undefined,
      site: site ? siteRouting() : undefined,
    });
  } catch {
    // An address the router cannot read gets Girici's error page rather than the browser's network error.
    return navigation ? htmlError("bad_request", 400, null) : Response.error();
  }

  switch (route.kind) {
    case "passthrough":
      return fetch(request);
    case "invalid":
      return navigation ? htmlError("bad_request", 400, null) : Response.error();
    case "unsealable":
      return navigation ? htmlError("sealed", 404, null) : Response.error();
    case "redirect":
      return Response.redirect(new URL(route.location, origin).href, 307);
    case "move":
      return moveTo(request, route.location);
    case "signin":
      return signIn(route.target);
    case "proxy": {
      // Checked before any relay request, so a shared link's first load shows the warning and nothing else.
      if (navigation && request.destination === "document" && (await warning.needed())) {
        const { pathname, search, hash } = new URL(request.url);
        const root = site ? siteMode.state()?.root : undefined;
        return warning.page(pathname + search + hash, route.target, root === undefined ? undefined : `${root}/`);
      }
      // A navigation that arrives from another site host is cross-site, not a direct one.
      const initiator =
        navigation && site
          ? navigationInitiator(referrer, origin, sealing.open, siteRouting() ?? null, request.method)
          : realUrlOf(navigation ? referrer : clientUrl, origin, sealing.open);
      const seal = route.sealed && master ? master.originSeal(route.target.origin) : undefined;
      const sealsLoad = navigation && request.destination === "document" && master && sealing.enabled();
      const address = sealsLoad ? (url: URL) => master.seal(url) : undefined;
      try {
        // A request sent right after a document.cookie write must carry that cookie.
        const seq = Number(request.headers.get(HEADER.cookieSeq));
        if (seq > 0 && event.clientId) await rpc.waitFor(event.clientId, seq);
        const cookieContext: CookieRequestContext = {
          initiator,
          credentials: request.credentials,
          topLevel: request.destination === "document",
          method: request.method,
          ...(site ? { privateDomains: true } : undefined),
        };
        const blocked = await cookiesBlocked(event, client, route.target);
        const cookieHeader = blocked ? null : await cookies.header(route.target, cookieContext);
        // Keep the untouched player request so we can re-ask as a non-SABR client.
        const ytPlayer = isYtPlayer(route.target) && request.method === "POST";
        const playerBody = ytPlayer ? await request.clone().arrayBuffer() : null;
        const result = await transport.send(request, {
          target: route.target,
          clientUrl: initiator,
          isNavigation: navigation,
          cookie: cookieHeader,
          ...(site ? { privateDomains: true } : undefined),
        });
        if (ytPlayer && playerBody && result.ok && result.response.body) {
          const webText = await new Response(result.response.body).text();
          const spliced = await spliceDirectStreams(
            playerBody,
            webText,
            request,
            route.target,
            initiator,
            cookieHeader,
            transport,
            mintPoToken,
          );
          result.response.body = new Response(spliced ?? webText).body;
          // The spliced body differs in length, so the upstream content-length no longer applies.
          result.response.headers = result.response.headers.filter(([name]) => name !== "content-length");
        }
        const changes =
          result.ok && !blocked ? await cookies.store(route.target, result.response.setCookies, cookieContext) : [];
        // A tab can leave a site host right after this page, and WebKit then stops the worker before the jar writes.
        if (site) event.waitUntil(cookies.saved());
        if (pageConfig) await pageConfig;
        const siteState = site ? siteMode.state() : null;
        if (siteState && topLevelGet && result.ok && siteMode.hostOf(route.target) === origin) {
          siteMode.learnSite(labelSiteOf(route.target));
        }
        return await buildPageResponse(result, {
          target: route.target,
          origin,
          destination: request.destination,
          navigation,
          clientScript: CLIENT_PATH,
          cookies: () => (blocked ? Promise.resolve([]) : cookies.snapshot(route.target)),
          syncCookies: navigation ? undefined : changes,
          cookiesBlocked: blocked,
          runtimeAvailable: async () => (await runtime.bytes(CLIENT_PATH)) !== null,
          seal,
          address,
          uiOrigin: siteState?.root,
          sites: (siteState && siteMode.context(route.target)) ?? undefined,
        });
      } catch {
        return navigation ? htmlError("connect", 502, route.target) : Response.error();
      }
    }
  }
}

/** This host's view of where each site lives, or undefined until the mode is known. */
function siteRouting(): SiteRouting | undefined {
  const state = siteMode.state();
  if (!state) return undefined;
  return { origin: self.location.origin, domain: state.domain, hostOf: (url) => siteMode.hostOf(url) };
}

/** WebKit drops a POST body across this worker's redirect, so a form gets a page that posts it again. */
async function moveTo(request: Request, location: string): Promise<Response> {
  const safe = request.method === "GET" || request.method === "HEAD";
  return (safe ? null : await resubmitResponse(request, location)) ?? Response.redirect(location, 307);
}

/** Sign-in lives on the root; the label key comes with the site session it starts. */
function signIn(target: URL): Response {
  const login = new URL(LOGIN_PATH, siteMode.state()?.root ?? self.location.origin);
  login.searchParams.set("next", target.href);
  return Response.redirect(login.href, 302);
}

/** With the switch on, a request whose site differs from its top-level page's site carries and stores no cookies. */
async function cookiesBlocked(event: FetchEvent, client: Client | undefined, target: URL): Promise<boolean> {
  await prefs.ready();
  if (!prefs.current().blockThirdPartyCookies) return false;
  const { request } = event;
  const topSite = await topSiteFor(
    {
      navigation: request.mode === "navigate",
      destination: request.destination,
      target,
      referrer: request.referrer || null,
      resultingClientId: event.resultingClientId ?? "",
      clientId: event.clientId,
    },
    client,
    topSiteDeps,
  );
  return isThirdParty(target, topSite);
}

async function askTop(clientId: string): Promise<string | null> {
  const client = await self.clients.get(clientId);
  if (!client) return null;
  const channel = new MessageChannel();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TOP_QUERY_TIMEOUT);
    channel.port1.onmessage = (event: MessageEvent<{ top?: unknown } | null>) => {
      clearTimeout(timer);
      resolve(typeof event.data?.top === "string" ? event.data.top : null);
    };
    client.postMessage({ type: TOP_SITE_QUERY }, [channel.port2]);
  });
}

/** Ask the server to mint a GVS poToken; same-origin, time-boxed, null on any failure. */
async function mintPoToken(contentBinding: string): Promise<string | null> {
  try {
    const response = await fetch(`${self.location.origin}${POT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentBinding }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { poToken: string | null }).poToken ?? null;
  } catch {
    return null;
  }
}

/** Hand the WebSocket shim a seal of the target's cookies and Origin, read from the jar as the page. */
async function handleWsPrep(event: FetchEvent): Promise<Response> {
  await Promise.all([cookies.ready(), sealing.ready()]);
  const client = await clientOf(event);
  const identity = await identityOf(event, client);
  const pageUrl =
    client?.type === "window"
      ? realUrlOf(client.url, self.location.origin, sealing.open)
      : identity && new URL(identity.page);
  let rawUrl: unknown;
  try {
    rawUrl = ((await event.request.json()) as { url?: unknown }).url;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof rawUrl !== "string") return new Response(null, { status: 400 });
  const prep = await buildWsPrep(
    cookies,
    rawUrl,
    pageUrl,
    async (target) => !(await cookiesBlocked(event, client, target)),
  );
  if (!prep) return new Response(null, { status: 400 });
  const seal = await sealWsPrep(prep, (body) =>
    fetch(`${self.location.origin}${WS_SEAL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    }),
  );
  return new Response(JSON.stringify({ seal }), { headers: { "content-type": "application/json" } });
}

async function handleSiteDataRpc(event: FetchEvent, site: boolean): Promise<Response> {
  const [client] = await Promise.all([clientOf(event), cookies.ready(), uiReady(), sealing.ready()]);
  return handleSiteData(event.request, callerOf(client, self.location.origin, ui, sealing.open), cookies, site);
}

async function handleCookieRpc(event: FetchEvent): Promise<Response> {
  await Promise.all([cookies.ready(), sealing.ready()]);
  const client = await clientOf(event);
  // Only a page's document.cookie calls here, and a worker cannot show which page it acts for.
  if (client?.type !== "window") return new Response(null, { status: 403 });
  const pageUrl = realUrlOf(client.url, self.location.origin, sealing.open);
  const blocked = pageUrl ? await cookiesBlocked(event, client, pageUrl) : false;
  const response = await rpc.handle(event.request, event.clientId, pageUrl, { blocked });
  event.waitUntil(forgetClosedClients());
  if (siteMode.settled() === "site") event.waitUntil(cookies.saved());
  return response;
}

/**
 * A page announces each worker it starts, and a worker its nested ones, before they exist. The caller's own place,
 * never the body, decides the identity the nonce binds to.
 */
async function handleWorkerRpc(event: FetchEvent): Promise<Response> {
  return answerAnnouncement(event.request, event.clientId, () => callerIdentity(event), workers);
}

/** The identity a nonce the caller announces binds to: its own page for a window, its own binding for a worker. */
async function callerIdentity(event: FetchEvent): Promise<WorkerIdentity | null> {
  const client = await clientOf(event);
  if (client?.type !== "window") return identityOf(event, client);
  // A blank frame's address is about:blank, so its workers stay unbound.
  await sealing.ready();
  const page = realUrlOf(client.url, self.location.origin, sealing.open);
  return page && { page: page.href, top: await windowTop(client, topSiteDeps) };
}

/** The page that started the request's client, when that client is not a window. */
async function identityOf(event: FetchEvent, client: Client | undefined): Promise<WorkerIdentity | null> {
  if (client?.type === "window" || !event.clientId) return null;
  return workers.identityOf(event.clientId);
}

/** Sequence numbers are kept per tab, so tabs that have closed are dropped once the list grows. */
async function forgetClosedClients(): Promise<void> {
  const ids = rpc.clientIds();
  if (ids.length <= 100) return;
  for (const id of ids) if (!(await self.clients.get(id))) rpc.forget(id);
}

/** Firefox never settles clients.get() for a worker blocked in a synchronous importScripts, so the lookup gives up. */
async function clientOf(event: FetchEvent): Promise<Client | undefined> {
  if (!event.clientId) return undefined;
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, CLIENT_LOOKUP_TIMEOUT));
  return Promise.race([self.clients.get(event.clientId), timeout]);
}

/** On a site host `/` belongs to the page's site, so the way home is the root. */
function htmlError(code: ErrorPageCode, status: number, target: URL | null): Response {
  const root = siteMode.state()?.root;
  return errorResponse(code, status, target, undefined, root === undefined ? undefined : `${root}/`);
}
