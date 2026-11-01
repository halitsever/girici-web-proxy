import { decodeHeaderList, encodeHeaderValue, HEADER, type RelayErrorCode } from "../shared/protocol.ts";
import { buildRelayRequest, type RelayContext } from "./relay-request.ts";

export interface UpstreamResponse {
  status: number;
  headers: Array<[string, string]>;
  setCookies: string[];
  body: ReadableStream<Uint8Array> | null;
}

export type TransportResult =
  { ok: true; response: UpstreamResponse } | { ok: false; code: RelayErrorCode; status: number; retryAfter?: number };

/** The seam where a Wisp transport, with TLS in the browser, can later replace our relay. */
export interface Transport {
  send(request: Request, ctx: RelayContext & { cookie: string | null }): Promise<TransportResult>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const CONNECT_ERROR: TransportResult = { ok: false, code: "connect", status: 502 };

export class HttpRelayTransport implements Transport {
  readonly #fetch: FetchLike;

  constructor(fetchImpl: FetchLike = (url, init) => fetch(url, init)) {
    this.#fetch = fetchImpl;
  }

  async send(request: Request, ctx: RelayContext & { cookie: string | null }): Promise<TransportResult> {
    const { url, init } = await buildRelayRequest(request, ctx);
    const headers = new Headers(init.headers);
    if (ctx.cookie) headers.set(HEADER.cookie, encodeHeaderValue(ctx.cookie));
    const abort = followAbort(request.signal);

    let relay: Response;
    try {
      relay = await this.#fetch(url, { ...init, headers, signal: abort.signal });
    } catch {
      return CONNECT_ERROR;
    }
    const error = relay.headers.get(HEADER.error);
    if (error) {
      const failure: TransportResult = { ok: false, code: error as RelayErrorCode, status: relay.status };
      // Digits only: an HTTP date or junk gives no wait rather than a wrong one.
      const wait = relay.headers.get("retry-after")?.trim();
      if (wait && /^\d{1,9}$/.test(wait)) failure.retryAfter = Number(wait);
      return failure;
    }
    try {
      const setCookie = relay.headers.get(HEADER.setCookie);
      return {
        ok: true,
        response: {
          status: Number(relay.headers.get(HEADER.status) ?? relay.status),
          headers: decodeHeaderList(relay.headers.get(HEADER.headers) ?? ""),
          setCookies: setCookie ? decodeHeaderList(setCookie).map(([, value]) => value) : [],
          // Navigations keep the native body: if Firefox stops an idle worker mid-download, a wrapped body ends as if complete.
          body: relay.body && !ctx.isNavigation ? abortOnCancel(relay.body, abort) : relay.body,
        },
      };
    } catch {
      return CONNECT_ERROR;
    }
  }
}

function followAbort(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  return controller;
}

/** Firefox leaves a fetch's connection open when only its body is cancelled, so the page's cancel aborts the relay fetch. */
function abortOnCancel(body: ReadableStream<Uint8Array>, abort: AbortController): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      abort.abort(reason);
      return reader.cancel(reason).catch(() => {});
    },
  });
}
