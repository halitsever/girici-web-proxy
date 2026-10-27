import { decodeHeaderList, encodeHeaderValue, HEADER, type RelayErrorCode } from "../shared/protocol.ts";
import { buildRelayRequest, type RelayContext } from "./relay-request.ts";

export interface UpstreamResponse {
  status: number;
  headers: Array<[string, string]>;
  setCookies: string[];
  body: ReadableStream<Uint8Array> | null;
}

export type TransportResult =
  { ok: true; response: UpstreamResponse } | { ok: false; code: RelayErrorCode; status: number };

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

    let relay: Response;
    try {
      relay = await this.#fetch(url, { ...init, headers });
    } catch {
      return CONNECT_ERROR;
    }
    const error = relay.headers.get(HEADER.error);
    if (error) return { ok: false, code: error as RelayErrorCode, status: relay.status };
    try {
      const setCookie = relay.headers.get(HEADER.setCookie);
      return {
        ok: true,
        response: {
          status: Number(relay.headers.get(HEADER.status) ?? relay.status),
          headers: decodeHeaderList(relay.headers.get(HEADER.headers) ?? ""),
          setCookies: setCookie ? decodeHeaderList(setCookie).map(([, value]) => value) : [],
          body: relay.body,
        },
      };
    } catch {
      return CONNECT_ERROR;
    }
  }
}
