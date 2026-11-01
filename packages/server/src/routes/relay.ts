import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { encodeHeaderList, HEADER, targetFromRelayPath } from "@girici/engine/shared";
import { Router, type Request, type Response } from "express";
import { request, type Dispatcher } from "undici";
import { clientKey } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import { sendRelayError } from "../http/relay-error.ts";
import { ByteCounter, NO_OBSERVER, type RelayObserver } from "../http/relay-observer.ts";
import type { Logger } from "../log.ts";
import type { HostBlocklist } from "../upstream/blocklist.ts";
import { RelayRequestError, relayErrorFor } from "../upstream/errors.ts";
import { proxyFailureLog } from "../upstream/proxy-failure.ts";
import { buildUpstreamHeaders } from "../upstream/request-headers.ts";
import { splitUpstreamHeaders } from "../upstream/response-headers.ts";
import { validateTarget } from "../upstream/ssrf.ts";

export interface RelayOptions {
  agent: Dispatcher;
  allowedTestHosts: ReadonlySet<string>;
  maxRequestBody: number;
  logger: Logger;
  blocklist?: HostBlocklist;
  observer?: RelayObserver;
}

const TUNNELED_METHOD = /^[A-Z]+$/;
const BLOCKED_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);
const NULL_BODY_STATUSES = new Set([204, 304]);

export function relayRouter(options: RelayOptions): Router {
  const router = Router();
  const onProxyFailure = proxyFailureLog(options.logger);
  // Mounted by prefix so Express never percent-decodes the target path.
  router.use("/_g/r", (req, res, next) => {
    relay(req, res, options, onProxyFailure).catch(next);
  });
  return router;
}

async function relay(
  req: Request,
  res: Response,
  options: RelayOptions,
  onProxyFailure: (error: unknown) => void,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    res.setHeader("Allow", "GET, HEAD, POST");
    sendRelayError(res, "bad_request", 405);
    return;
  }
  // The custom marker forces a CORS preflight for cross-site callers, which nothing here answers.
  const fetchSite = req.get("sec-fetch-site");
  if (req.get(HEADER.relay) !== "1" || (fetchSite && fetchSite !== "same-origin")) {
    sendRelayError(res, "bad_request", 403);
    return;
  }
  if (req.method === "POST" && !isOwnHost(req.get("origin"), req.get("host"))) {
    sendRelayError(res, "bad_request", 403);
    return;
  }
  const target = targetFromRelayPath(req.originalUrl);
  if (!target) {
    sendRelayError(res, "bad_request", 400);
    return;
  }

  const observer = options.observer ?? NO_OBSERVER;
  const key = clientKey(req.ip ?? "?");
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  try {
    if (options.blocklist?.isBlocked(target.hostname)) throw new RelayRequestError("blocked", 403);
    validateTarget(target, { allowedTestHosts: options.allowedTestHosts, selfHost: req.get("host") });
    const method = upstreamMethod(req);
    if (Number(req.get("content-length") ?? 0) > options.maxRequestBody) throw new RelayRequestError("too_large", 413);
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : req.pipe(new ByteLimit(options.maxRequestBody, (bytes) => observer.bytes(key, bytes, "up")));
    const headers = buildUpstreamHeaders(req.headers);
    // Presigned storage URLs and many other upload endpoints refuse chunked bodies.
    const length = req.get("content-length");
    if (body && length) headers["content-length"] = length;
    const upstream = await request(target, {
      dispatcher: options.agent,
      method: method as Dispatcher.HttpMethod,
      headers,
      body,
      signal: controller.signal,
    });

    const { native, envelope, setCookies } = splitUpstreamHeaders(upstream.headers);
    res.status(relayStatus(upstream.statusCode));
    // setHeader, not res.set: Express would add a charset to text content types and break legacy encodings.
    for (const [name, value] of Object.entries(native)) res.setHeader(name, value);
    res.setHeader(HEADER.status, String(upstream.statusCode));
    res.setHeader(HEADER.headers, encodeHeaderList(envelope));
    if (setCookies.length > 0) {
      res.setHeader(HEADER.setCookie, encodeHeaderList(setCookies.map((value) => ["set-cookie", value] as const)));
      // A replayed cached response must never resurrect cookies.
      res.setHeader("Cache-Control", "no-store");
    }
    // A gate may have renewed a cookie of ours, which a cached copy would hand back after it expired.
    if (res.hasHeader("set-cookie")) res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    if (req.method === "HEAD" || NULL_BODY_STATUSES.has(upstream.statusCode)) {
      await upstream.body.dump();
      res.end();
      return;
    }
    await pipeline(upstream.body, new ByteCounter((bytes) => observer.bytes(key, bytes, "down")), res);
  } catch (error) {
    if (controller.signal.aborted) return;
    const { code, status } = relayErrorFor(error);
    options.logger.debug(`relay ${code} ${target.host}`);
    onProxyFailure(error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendRelayError(res, code, status);
  }
}

function upstreamMethod(req: Request): string {
  const tunneled = req.get(HEADER.method);
  if (req.method !== "POST" || !tunneled) return req.method;
  if (!TUNNELED_METHOD.test(tunneled) || BLOCKED_METHODS.has(tunneled)) throw new RelayRequestError("bad_request", 400);
  return tunneled;
}

/** Redirects are mapped by the service worker, and a 3xx relay response would reach it as an opaque redirect. */
function relayStatus(status: number): number {
  if ((status >= 300 && status < 400 && status !== 304) || status < 200 || status > 599) return 200;
  return status;
}

class ByteLimit extends Transform {
  #seen = 0;
  readonly #limit: number;
  readonly #count: ((bytes: number) => void) | undefined;

  constructor(limit: number, count?: (bytes: number) => void) {
    super();
    this.#limit = limit;
    this.#count = count;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.#seen += chunk.length;
    this.#count?.(chunk.length);
    if (this.#seen > this.#limit) callback(new RelayRequestError("too_large", 413));
    else callback(null, chunk);
  }
}
