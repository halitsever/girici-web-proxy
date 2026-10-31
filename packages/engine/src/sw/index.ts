import { isReservedPath } from "../shared/codec.ts";
import {
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  HEADER,
  POT_PATH,
  PROTOCOL_VERSION,
  SITE_DATA_RPC_PATH,
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
import { errorResponse, forbiddenResponse, type ErrorPageCode } from "./error-page.ts";
import { buildPageResponse } from "./page-response.ts";
import { createIdbPrefsStore, PrefsService, readPrefsMessage } from "./prefs.ts";
import { createIdbKeyStore, readInstanceSeal, readSealMessage, Sealing } from "./sealing.ts";
import { isSealedPath } from "../shared/sealed-address.ts";
import { classifyRequest, isGuardedPath, realUrlOf, requestClientUrl, reservedAccess } from "./route.ts";
import { CookieRpc } from "./rpc.ts";
import { callerOf, handleSiteData } from "./site-data.ts";
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
// The admin's switch reaches open tabs within a minute without a UI tab telling the worker.
const INSTANCE_SEAL_INTERVAL = 60_000;
let instanceSealCheckedAt = -Infinity;
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

self.addEventListener("install", (event) => {
  event.waitUntil(runtime.install().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  seeding = seedUiClients();
  refreshInstanceSeal(true);
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

/** Fire and forget; a failed check keeps the switch the worker last heard. */
function refreshInstanceSeal(force = false): void {
  const now = Date.now();
  if (!force && now - instanceSealCheckedAt < INSTANCE_SEAL_INTERVAL) return;
  instanceSealCheckedAt = now;
  void readInstanceSeal(() => fetch(`${self.location.origin}/_g/auth/state`, { cache: "no-store" })).then(
    (instanceSeal) => (instanceSeal === null ? undefined : prefs.set({ instanceSeal })),
  );
}

async function uiReady(): Promise<void> {
  await Promise.all([ui.ready(), seeding]);
}

self.addEventListener("message", (event) => {
  // The bootstrap page asks for control at once instead of waiting for the next navigation.
  if ((event.data as { type?: unknown } | null)?.type === "girici:claim") {
    event.waitUntil(self.clients.claim());
    return;
  }
  const answer = event.ports[0];
  event.waitUntil(
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
      if ((event.data as { instanceSeal?: unknown }).instanceSeal === false) refreshInstanceSeal(true);
      // The UI waits for this answer before navigating, so the next page already sees the new choice.
      answer?.postMessage({ ok: true });
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (loadsUi(event.request, url, self.location.origin)) {
    if (event.resultingClientId) ui.add(event.resultingClientId);
    // Answering keeps the page controlled under this ID, which Playwright's Firefox loses when a navigation falls
    // back. Once the worker answers, a server that is down gets Girici's error page instead of the browser's.
    event.respondWith(fetch(event.request).catch(() => htmlError("connect", 502, url)));
    return;
  }
  // The query is ignored for serving: a worker's import carries the nonce its page announced.
  if (url.origin === self.location.origin && runtime.has(url.pathname)) {
    const nonce = readNonce(url);
    if (nonce && event.clientId) event.waitUntil(workers.claim(event.clientId, nonce));
    event.respondWith(runtime.response(url.pathname));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === WORKER_RPC_PATH && event.request.method === "POST") {
    event.respondWith(handleWorkerRpc(event));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === COOKIE_RPC_PATH && event.request.method === "POST") {
    event.respondWith(handleCookieRpc(event));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === WS_PREP_PATH && event.request.method === "POST") {
    event.respondWith(handleWsPrep(event));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === SITE_DATA_RPC_PATH && event.request.method === "POST") {
    event.respondWith(handleSiteDataRpc(event));
    return;
  }
  if (url.origin === self.location.origin && isGuardedPath(url.pathname)) {
    if (event.request.mode === "navigate") {
      // A navigation has no client yet, so only its shape is judged.
      if (reservedAccess(url.pathname, event.request, undefined, self.location.origin, ui) === "deny") {
        event.respondWith(forbiddenResponse());
      }
      return;
    }
    event.respondWith(guardReserved(event, url.pathname));
    return;
  }
  if (url.origin === self.location.origin && isReservedPath(url.pathname)) return;
  event.respondWith(handle(event));
});

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
async function guardReserved(event: FetchEvent, pathname: string): Promise<Response> {
  const [client] = await Promise.all([clientOf(event), uiReady()]);
  const decision = reservedAccess(pathname, event.request, client, self.location.origin, ui);
  return decision === "allow" ? fetch(event.request) : forbiddenResponse();
}

async function handle(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const origin = self.location.origin;
  const navigation = request.mode === "navigate";
  const client = await clientOf(event);
  const referrer = request.referrer || null;
  // A worker stuck in importScripts cannot be looked up, but its binding is known by its client ID.
  const identity = await identityOf(event, client);
  const clientUrl = requestClientUrl({ client, identity }, origin);
  const topLevelGet = navigation && request.destination === "document" && request.method === "GET";
  if (topLevelGet) refreshInstanceSeal();
  await Promise.all([cookies.ready(), sealing.ready()]);
  const master = await sealing.sealerFor(isSealedPath(new URL(request.url).pathname));
  const route = classifyRequest({
    url: request.url,
    origin,
    navigation,
    clientUrl,
    referrer,
    topLevelGet,
    open: sealing.open,
    seal: master ? (url) => master.seal(url) : undefined,
  });

  switch (route.kind) {
    case "passthrough":
      return fetch(request);
    case "invalid":
      return navigation ? htmlError("bad_request", 400, null) : Response.error();
    case "unsealable":
      return navigation ? htmlError("sealed", 404, null) : Response.error();
    case "redirect":
      return Response.redirect(new URL(route.location, origin).href, 307);
    case "proxy": {
      const initiator = realUrlOf(navigation ? referrer : clientUrl, origin, sealing.open);
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
        });
      } catch {
        return navigation ? htmlError("connect", 502, route.target) : Response.error();
      }
    }
  }
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

async function handleSiteDataRpc(event: FetchEvent): Promise<Response> {
  const [client] = await Promise.all([clientOf(event), cookies.ready(), uiReady(), sealing.ready()]);
  return handleSiteData(event.request, callerOf(client, self.location.origin, ui, sealing.open), cookies);
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

function htmlError(code: ErrorPageCode, status: number, target: URL | null): Response {
  return errorResponse(code, status, target);
}
