import { relayPathFor } from "../shared/codec.ts";
import { encodeHeaderList, encodeHeaderValue, HEADER } from "../shared/protocol.ts";
import { refererFor } from "../shared/referrer.ts";
import { secFetchSite } from "./fetch-meta.ts";
import { isCrossSite } from "./initiator.ts";

export interface RelayContext {
  target: URL;
  clientUrl: URL | null;
  isNavigation: boolean;
  /** As in `CookieRequestContext`. */
  privateDomains?: boolean;
}

// Sent as real headers so the browser HTTP cache can key and revalidate relay responses.
const NATIVE_HEADERS = ["accept", "range", "content-type"];

export async function buildRelayRequest(
  request: Request,
  ctx: RelayContext,
): Promise<{ url: string; init: RequestInit }> {
  const method = request.method.toUpperCase();
  const tunneled = method !== "GET" && method !== "HEAD";
  const headers = new Headers({ [HEADER.relay]: "1", accept: request.headers.get("accept") ?? "*/*" });
  for (const name of NATIVE_HEADERS.slice(1)) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const envelope: Array<[string, string]> = [];
  request.headers.forEach((value, name) => {
    if (!NATIVE_HEADERS.includes(name) && !name.startsWith("x-girici-")) envelope.push([name, value]);
  });
  if (envelope.length > 0) headers.set(HEADER.headers, encodeHeaderList(envelope));

  // An initiator known only as another site is what a browser sends under no-referrer: no Referer, Origin null.
  const crossSite = isCrossSite(ctx.clientUrl);
  const site = crossSite ? "cross-site" : secFetchSite(ctx.clientUrl, ctx.target, ctx.privateDomains);
  const fetchMeta = ctx.isNavigation
    ? `document;navigate;${site};?1`
    : `${request.destination || "empty"};${request.mode};${site};`;
  headers.set(HEADER.fetch, encodeHeaderValue(fetchMeta));

  // Browsers send Origin on unsafe methods and on cross-origin CORS requests, not on same-origin reads.
  const crossOriginCors = request.mode === "cors" && ctx.clientUrl?.origin !== ctx.target.origin;
  if (ctx.clientUrl && (tunneled || crossOriginCors))
    headers.set(HEADER.origin, encodeHeaderValue(crossSite ? "null" : ctx.clientUrl.origin));
  const referer = crossSite ? null : refererFor(ctx.clientUrl, ctx.target, request.referrerPolicy);
  if (referer) headers.set(HEADER.referer, encodeHeaderValue(referer));

  const init: RequestInit = {
    method: tunneled ? "POST" : method,
    headers,
    redirect: "manual",
    credentials: "same-origin",
    cache: request.cache === "only-if-cached" ? "default" : request.cache,
    referrerPolicy: "no-referrer",
    signal: request.signal,
  };
  if (tunneled) {
    headers.set(HEADER.method, method);
    init.body = await request.arrayBuffer();
  }
  return { url: relayPathFor(ctx.target), init };
}
