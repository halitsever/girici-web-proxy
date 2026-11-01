import {
  append,
  apply,
  hrefOf,
  includes,
  isArray,
  mapOf,
  newUrl,
  ownValue,
  parseJson,
  parseUrl,
  protocolOf,
  quoteJson,
  sliceOf,
  startsWith,
  stringOf,
} from "../shared/primordials.ts";
import { WS_PREP_PATH } from "../shared/protocol.ts";
import type { UrlContext } from "./url-context.ts";

const SUBPROTOCOL = "girici.v1";
/** Taken at load, for a realm that has no DOMException to throw. */
const NativeSyntaxError = SyntaxError;

/** Reflect the upstream close code the browser refuses to send in close(). */
function mapIncomingClose(code: number): number {
  if (code === 1005) return 1000;
  if (code === 1006 || code === 1015) return 1011;
  return code;
}

/** Only 1000 and the private range are legal to send; anything else drops to a bare close. */
function sendableClose(code: number | undefined): number | undefined {
  if (code === 1000 || (typeof code === "number" && code >= 3000 && code <= 4999)) return code;
  return undefined;
}

function protocolList(protocols: string | string[] | undefined): string[] {
  if (protocols == null) return [];
  return isArray(protocols) ? mapOf(protocols, stringOf) : [stringOf(protocols)];
}

/** Written out from strings, so neither a replaced JSON.stringify nor a toJSON the page added ever sees the seal. */
function openingFrame(url: string, protocols: string[], seal: string | null): string {
  let list = "";
  for (let index = 0; index < protocols.length; index++)
    list += (index ? "," : "") + quoteJson(protocols[index] as string);
  return `{"u":${quoteJson(url)},"p":[${list}],"s":${seal === null ? "null" : quoteJson(seal)}}`;
}

/** The globals the shim reads and replaces, which a window and a worker scope both carry. */
export interface WebSocketRealm {
  WebSocket: typeof WebSocket;
  fetch: typeof fetch;
  EventTarget: typeof EventTarget;
  Event: typeof Event;
  MessageEvent: typeof MessageEvent;
  CloseEvent: typeof CloseEvent;
  Blob: typeof Blob;
  DOMException?: typeof DOMException;
}

/** Route page and worker WebSockets through the server relay while keeping the browser API intact. */
export function installWebSocket(
  realm: WebSocketRealm,
  ctx: Pick<UrlContext, "origin" | "realUrl"> & Partial<Pick<UrlContext, "realBase">>,
): void {
  const Native = realm.WebSocket;
  const nativeFetch = realm.fetch;
  const Exception = realm.DOMException;
  const relayUrl = (startsWith(ctx.origin, "http") ? `ws${sliceOf(ctx.origin, 4)}` : ctx.origin) + "/_g/ws";

  const syntaxError = (message: string): Error =>
    Exception ? new Exception(message, "SyntaxError") : new NativeSyntaxError(message);
  /** As the browser reads a socket address: against the base, http(s) as ws(s), and no other scheme or fragment. */
  const socketUrl = (raw: string): URL => {
    const parsed = parseUrl(raw, ctx.realBase ? ctx.realBase() : ctx.realUrl());
    if (!parsed) throw syntaxError(`The URL '${raw}' is invalid.`);
    const href = hrefOf(parsed);
    const protocol = protocolOf(parsed);
    let url = parsed;
    if (protocol === "http:") url = newUrl(`ws${sliceOf(href, 4)}`);
    else if (protocol === "https:") url = newUrl(`wss${sliceOf(href, 5)}`);
    else if (protocol !== "ws:" && protocol !== "wss:")
      throw syntaxError(
        `The URL's scheme must be either 'http', 'https', 'ws', or 'wss'. '${protocol}' is not allowed.`,
      );
    if (includes(href, "#")) throw syntaxError("Fragment identifiers are not allowed in WebSocket URLs.");
    return url;
  };

  class GiriciWebSocket extends realm.EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    protocol = "";
    extensions = "";
    binaryType: BinaryType = "blob";
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    #inner: WebSocket | null = null;
    #opened = false;
    #queue: Array<string | ArrayBuffer | Blob | ArrayBufferView> = [];
    #bufferedBeforeOpen = 0;

    constructor(url: string | URL, protocols?: string | string[]) {
      const real = socketUrl(stringOf(url));
      super();
      this.url = hrefOf(real);
      void this.#connect(real, protocolList(protocols));
    }

    get bufferedAmount(): number {
      return this.#opened && this.#inner ? (this.#inner.bufferedAmount ?? 0) : this.#bufferedBeforeOpen;
    }

    async #connect(real: URL, protocols: string[]): Promise<void> {
      // An opaque seal of the cookie and Origin; this page never sees the cookie itself.
      let seal: string | null = null;
      try {
        const response = await nativeFetch(ctx.origin + WS_PREP_PATH, {
          __proto__: null,
          method: "POST",
          headers: { __proto__: null, "content-type": "application/json" } as unknown as HeadersInit,
          body: `{"url":${quoteJson(hrefOf(real))}}`,
        } as RequestInit);
        const answer: unknown = response.ok ? await response.json() : null;
        const given = typeof answer === "object" && answer !== null ? ownValue(answer, "seal") : null;
        seal = typeof given === "string" ? given : null;
      } catch {
        // Fall back to no cookie; the handshake may still succeed for an unauthenticated socket.
      }
      if (this.readyState === 3) return;
      const inner = new Native(relayUrl, [SUBPROTOCOL]);
      inner.binaryType = "arraybuffer";
      this.#inner = inner;
      inner.onopen = () => inner.send(openingFrame(hrefOf(real), protocols, seal));
      inner.onmessage = (event: MessageEvent) => this.#fromRelay(event.data);
      inner.onclose = (event: CloseEvent) => this.#closed(event.code, event.reason, event.wasClean);
      inner.onerror = () => {
        if (!this.#opened) this.#emit(new realm.Event("error"));
      };
    }

    #fromRelay(data: unknown): void {
      if (!this.#opened) {
        let control: unknown = null;
        try {
          control = typeof data === "string" ? parseJson(data) : null;
        } catch {
          control = null;
        }
        if (typeof control === "object" && control !== null && ownValue(control, "t") === "open") {
          const protocol = ownValue(control, "p");
          this.#open(typeof protocol === "string" ? protocol : undefined);
        } else this.#inner?.close();
        return;
      }
      if (isArrayBuffer(data) && this.binaryType === "blob")
        this.#emit(new realm.MessageEvent("message", { data: new realm.Blob([data as ArrayBuffer]) }));
      else this.#emit(new realm.MessageEvent("message", { data }));
    }

    #open(protocol: string | undefined): void {
      this.#opened = true;
      this.readyState = 1;
      this.protocol = protocol ?? "";
      const queue = this.#queue;
      for (let index = 0; index < queue.length; index++) {
        this.#inner?.send(queue[index] as Parameters<WebSocket["send"]>[0]);
      }
      this.#queue = [];
      this.#bufferedBeforeOpen = 0;
      this.#emit(new realm.Event("open"));
    }

    send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
      if (this.readyState === 0) {
        append(this.#queue, data);
        this.#bufferedBeforeOpen += sizeOf(data);
        return;
      }
      if (this.readyState !== 1) return;
      this.#inner?.send(data as Parameters<WebSocket["send"]>[0]);
    }

    close(code?: number, reason?: string): void {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      if (this.#inner) this.#inner.close(sendableClose(code), reason);
      else this.#closed(code ?? 1000, reason ?? "", true);
    }

    #closed(code: number, reason: string, wasClean: boolean): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (!this.#opened && !wasClean) this.#emit(new realm.Event("error"));
      this.#emit(new realm.CloseEvent("close", { code: mapIncomingClose(code), reason: reason ?? "", wasClean }));
    }

    #emit(event: Event): void {
      const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
      if (typeof handler === "function") (handler as (event: Event) => void).call(this, event);
      this.dispatchEvent(event);
    }
  }

  realm.WebSocket = GiriciWebSocket as unknown as typeof WebSocket;
}

function sizeOf(data: string | ArrayBuffer | Blob | ArrayBufferView): number {
  if (typeof data === "string") return data.length;
  if ("byteLength" in data) return data.byteLength;
  if ("size" in data) return data.size;
  return 0;
}

const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

/** By the native getter, which works across realms: an adopted frame's socket hands out its own ArrayBuffers. */
function isArrayBuffer(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !arrayBufferLength) return false;
  try {
    apply(arrayBufferLength, value, []);
    return true;
  } catch {
    return false;
  }
}
