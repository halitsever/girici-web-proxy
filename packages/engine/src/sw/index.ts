import { isReservedPath } from "../shared/codec.ts";
import {
  BROADCAST_CHANNEL,
  COOKIE_RPC_PATH,
  HEADER,
  PROTOCOL_VERSION,
  type RelayErrorCode,
} from "../shared/protocol.ts";
import { createIdbCookieStore } from "./cookies/idb-store.ts";
import { CookieService, type CookieRequestContext } from "./cookies/jar.ts";
import { errorPage } from "./error-page.ts";
import { buildPageResponse } from "./page-response.ts";
import { classifyRequest, realUrlOf } from "./route.ts";
import { CookieRpc } from "./rpc.ts";
import { HttpRelayTransport } from "./transport.ts";

declare const self: ServiceWorkerGlobalScope;
declare const __GIRICI_CLIENT__: string;

const CLIENT_PATH = __GIRICI_CLIENT__;
// Each worker keeps the runtime it was built with, so a server update cannot hand old workers a mismatched one.
const CLIENT_CACHE = `girici:${CLIENT_PATH}`;
const transport = new HttpRelayTransport();
const cookies = new CookieService(createIdbCookieStore());
const rpc = new CookieRpc(cookies);
const channel = new BroadcastChannel(BROADCAST_CHANNEL);
// Other tabs of the same site keep their document.cookie mirrors current through this channel.
cookies.onChange((changes) => channel.postMessage({ type: "cookies", v: PROTOCOL_VERSION, changes }));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CLIENT_CACHE)
      .then((cache) => cache.add(CLIENT_PATH))
      .then(() => self.skipWaiting()),
  );
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
  if ((event.data as { type?: unknown } | null)?.type === "girici:claim") event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === CLIENT_PATH) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
    return;
  }
  if (url.origin === self.location.origin && url.pathname === COOKIE_RPC_PATH && event.request.method === "POST") {
    event.respondWith(handleCookieRpc(event));
    return;
  }
  if (url.origin === self.location.origin && isReservedPath(url.pathname)) return;
  event.respondWith(handle(event));
});

async function handle(event: FetchEvent): Promise<Response> {
  const { request } = event;
  const origin = self.location.origin;
  const navigation = request.mode === "navigate";
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  const referrer = request.referrer || null;
  const route = classifyRequest({ url: request.url, origin, navigation, clientUrl: client?.url ?? null, referrer });

  switch (route.kind) {
    case "passthrough":
      return fetch(request);
    case "invalid":
      return navigation ? htmlError("bad_request", 400, null) : Response.error();
    case "redirect":
      return Response.redirect(new URL(route.location, origin).href, 307);
    case "proxy": {
      const clientUrl = realUrlOf(navigation ? referrer : (client?.url ?? null), origin);
      try {
        await cookies.ready();
        // A request sent right after a document.cookie write must carry that cookie.
        const seq = Number(request.headers.get(HEADER.cookieSeq));
        if (seq > 0 && event.clientId) await rpc.waitFor(event.clientId, seq);
        const cookieContext: CookieRequestContext = {
          initiator: clientUrl,
          credentials: request.credentials,
          topLevel: request.destination === "document",
          method: request.method,
        };
        const result = await transport.send(request, {
          target: route.target,
          clientUrl,
          isNavigation: navigation,
          cookie: await cookies.header(route.target, cookieContext),
        });
        const changes = result.ok ? await cookies.store(route.target, result.response.setCookies, cookieContext) : [];
        return await buildPageResponse(result, {
          target: route.target,
          origin,
          destination: request.destination,
          navigation,
          clientScript: CLIENT_PATH,
          cookies: () => cookies.snapshot(route.target),
          syncCookies: navigation ? undefined : changes,
        });
      } catch {
        return navigation ? htmlError("connect", 502, route.target) : Response.error();
      }
    }
  }
}

async function handleCookieRpc(event: FetchEvent): Promise<Response> {
  await cookies.ready();
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  const response = await rpc.handle(
    event.request,
    event.clientId,
    realUrlOf(client?.url ?? null, self.location.origin),
  );
  event.waitUntil(forgetClosedClients());
  return response;
}

/** Sequence numbers are kept per tab, so tabs that have closed are dropped once the list grows. */
async function forgetClosedClients(): Promise<void> {
  const ids = rpc.clientIds();
  if (ids.length <= 100) return;
  for (const id of ids) if (!(await self.clients.get(id))) rpc.forget(id);
}

function htmlError(code: RelayErrorCode, status: number, target: URL | null): Response {
  return new Response(errorPage(code, target), { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
