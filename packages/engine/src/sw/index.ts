import { isReservedPath } from "../shared/codec.ts";
import type { RelayErrorCode } from "../shared/protocol.ts";
import { errorPage } from "./error-page.ts";
import { buildPageResponse } from "./page-response.ts";
import { buildRelayRequest } from "./relay-request.ts";
import { classifyRequest, realUrlOf } from "./route.ts";

declare const self: ServiceWorkerGlobalScope;
declare const __GIRICI_CLIENT__: string;

const CLIENT_PATH = __GIRICI_CLIENT__;
// Each worker keeps the runtime it was built with, so a server update cannot hand old workers a mismatched one.
const CLIENT_CACHE = `girici:${CLIENT_PATH}`;

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
        const { url, init } = await buildRelayRequest(request, {
          target: route.target,
          clientUrl,
          isNavigation: navigation,
        });
        const relay = await fetch(url, init);
        return buildPageResponse(relay, route.target, navigation ? "navigation" : "subresource", origin);
      } catch {
        return navigation ? htmlError("connect", 502, route.target) : Response.error();
      }
    }
  }
}

function htmlError(code: RelayErrorCode, status: number, target: URL | null): Response {
  return new Response(errorPage(code, target), { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
