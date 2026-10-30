import { isReservedPath } from "../shared/codec.ts";
import {
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  HEADER,
  POT_PATH,
  PROTOCOL_VERSION,
  SITE_DATA_RPC_PATH,
  TOP_SITE_QUERY,
  WS_PREP_PATH,
  WS_SEAL_PATH,
  type CookieSnapshot,
  type RelayErrorCode,
} from "../shared/protocol.ts";
import { cookieDeliveries } from "./cookie-broadcast.ts";
import { createIdbCookieStore } from "./cookies/idb-store.ts";
import { CookieService, type CookieRequestContext } from "./cookies/jar.ts";
import { errorResponse, forbiddenResponse } from "./error-page.ts";
import { buildPageResponse } from "./page-response.ts";
import { createIdbPrefsStore, PrefsService, readPrefsMessage } from "./prefs.ts";
import { classifyRequest, isGuardedPath, realUrlOf, reservedAccess } from "./route.ts";
import { CookieRpc } from "./rpc.ts";
import { callerOf, handleSiteData } from "./site-data.ts";
import { FrameTops, isThirdParty, topSiteFor, type TopSiteDeps } from "./third-party.ts";
import { RuntimeStore, sha256Hex } from "./runtime-store.ts";
import { HttpRelayTransport } from "./transport.ts";
import { buildWsPrep, sealWsPrep } from "./ws-prep.ts";
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
const topSiteDeps: TopSiteDeps = {
  frames: new FrameTops(),
  origin: self.location.origin,
  windowClients: () => self.clients.matchAll({ type: "window" }),
  askTop,
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
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("girici:") && key !== CLIENT_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // The bootstrap page asks for control at once instead of waiting for the next navigation.
  if ((event.data as { type?: unknown } | null)?.type === "girici:claim") {
    event.waitUntil(self.clients.claim());
    return;
  }
  const update = readPrefsMessage(event.data, event.source as Client | null, self.location.origin);
  if (!update) return;
  // The UI waits for this answer before navigating, so the next page already sees the new choice.
  const answer = event.ports[0];
  event.waitUntil(prefs.set(update).then(() => answer?.postMessage({ ok: true })));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // The query is ignored: workers import the runtime with a nonce suffix.
  if (url.origin === self.location.origin && runtime.has(url.pathname)) {
    event.respondWith(runtime.response(url.pathname));
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
      // Navigations are judged without a client lookup, so the login and setup screens load at once.
      if (reservedAccess(url.pathname, event.request, undefined, self.location.origin) === "deny") {
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
  const clients = await self.clients.matchAll({ type: "window" });
  for (const delivery of cookieDeliveries(clients, changes, self.location.origin)) {
    delivery.client.postMessage({
      type: COOKIE_MESSAGE,
      v: PROTOCOL_VERSION,
      changes: delivery.changes,
    });
  }
}

/** A client that cannot be looked up in time counts as a page, not as the UI. */
async function guardReserved(event: FetchEvent, pathname: string): Promise<Response> {
  const client = await clientOf(event);
  const decision = reservedAccess(pathname, event.request, client, self.location.origin);
  return decision === "allow" ? fetch(event.request) : forbiddenResponse();
}

async function handle(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const origin = self.location.origin;
  const navigation = request.mode === "navigate";
  const client = await clientOf(event);
  const referrer = request.referrer || null;
  // A worker stuck in importScripts cannot be looked up, but its requests still name it as the referrer.
  const clientUrl = client?.url ?? (navigation ? null : referrer);
  const route = classifyRequest({ url: request.url, origin, navigation, clientUrl, referrer });

  switch (route.kind) {
    case "passthrough":
      return fetch(request);
    case "invalid":
      return navigation ? htmlError("bad_request", 400, null) : Response.error();
    case "redirect":
      return Response.redirect(new URL(route.location, origin).href, 307);
    case "proxy": {
      const initiator = realUrlOf(navigation ? referrer : clientUrl, origin);
      try {
        await cookies.ready();
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
  await cookies.ready();
  const client = await clientOf(event);
  const pageUrl = realUrlOf(client?.url ?? null, self.location.origin);
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
  await cookies.ready();
  return handleSiteData(event.request, callerOf(await clientOf(event), self.location.origin), cookies);
}

async function handleCookieRpc(event: FetchEvent): Promise<Response> {
  await cookies.ready();
  const client = await clientOf(event);
  const pageUrl = realUrlOf(client?.url ?? null, self.location.origin);
  const blocked = pageUrl ? await cookiesBlocked(event, client, pageUrl) : false;
  const response = await rpc.handle(event.request, event.clientId, pageUrl, { blocked });
  event.waitUntil(forgetClosedClients());
  return response;
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

function htmlError(code: RelayErrorCode, status: number, target: URL | null): Response {
  return errorResponse(code, status, target);
}
