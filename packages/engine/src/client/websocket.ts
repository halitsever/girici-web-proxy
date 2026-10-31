import { apply } from "../shared/primordials.ts";
import { WS_PREP_PATH } from "../shared/protocol.ts";
import type { Realm, UrlContext } from "./url-context.ts";

const SUBPROTOCOL = "girici.v1";

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
  return Array.isArray(protocols) ? protocols : [protocols];
}

/** Route page WebSockets through the server relay while keeping the browser API intact. */
export function installWebSocket(win: Realm, ctx: UrlContext): void {
  const Native = win.WebSocket;
  const nativeFetch = win.fetch;
  const relayUrl = ctx.origin.replace(/^http/, "ws") + "/_g/ws";

  class GiriciWebSocket extends win.EventTarget {
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
      super();
      const real = new URL(String(url), ctx.realUrl().href);
      this.url = real.href;
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
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: real.href }),
        });
        if (response.ok) seal = ((await response.json()) as { seal?: string | null }).seal ?? null;
      } catch {
        // Fall back to no cookie; the handshake may still succeed for an unauthenticated socket.
      }
      if (this.readyState === 3) return;
      const inner = new Native(relayUrl, [SUBPROTOCOL]);
      inner.binaryType = "arraybuffer";
      this.#inner = inner;
      inner.onopen = () => inner.send(JSON.stringify({ u: real.href, p: protocols, s: seal }));
      inner.onmessage = (event: MessageEvent) => this.#fromRelay(event.data);
      inner.onclose = (event: CloseEvent) => this.#closed(event.code, event.reason, event.wasClean);
      inner.onerror = () => {
        if (!this.#opened) this.#emit(new win.Event("error"));
      };
    }

    #fromRelay(data: unknown): void {
      if (!this.#opened) {
        let control: { t?: string; p?: string } | null = null;
        try {
          control = typeof data === "string" ? (JSON.parse(data) as { t?: string; p?: string }) : null;
        } catch {
          control = null;
        }
        if (control?.t === "open") this.#open(control.p);
        else this.#inner?.close();
        return;
      }
      if (isArrayBuffer(data) && this.binaryType === "blob")
        this.#emit(new win.MessageEvent("message", { data: new win.Blob([data as ArrayBuffer]) }));
      else this.#emit(new win.MessageEvent("message", { data }));
    }

    #open(protocol: string | undefined): void {
      this.#opened = true;
      this.readyState = 1;
      this.protocol = protocol ?? "";
      for (const item of this.#queue) this.#inner?.send(item as Parameters<WebSocket["send"]>[0]);
      this.#queue = [];
      this.#bufferedBeforeOpen = 0;
      this.#emit(new win.Event("open"));
    }

    send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
      if (this.readyState === 0) {
        this.#queue.push(data);
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
      if (!this.#opened && !wasClean) this.#emit(new win.Event("error"));
      this.#emit(new win.CloseEvent("close", { code: mapIncomingClose(code), reason: reason ?? "", wasClean }));
    }

    #emit(event: Event): void {
      const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
      if (typeof handler === "function") (handler as (event: Event) => void).call(this, event);
      this.dispatchEvent(event);
    }
  }

  win.WebSocket = GiriciWebSocket as unknown as typeof WebSocket;
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
