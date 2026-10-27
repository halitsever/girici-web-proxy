import type { Realm } from "./url-context.ts";

// WebRTC stays off in v2.0 so it cannot reveal the user's address; the others have no relay yet.
const REMOVED = ["RTCPeerConnection", "webkitRTCPeerConnection", "WebSocketStream", "WebTransport"];

/** Until the WebSocket relay exists, sockets fail like an unreachable server instead of connecting around the proxy. */
export function installRealtimeBlock(win: Realm): void {
  for (const name of REMOVED) Reflect.deleteProperty(win, name);
  win.WebSocket = blockedWebSocket(win) as unknown as typeof WebSocket;
}

function blockedWebSocket(win: Realm) {
  return class WebSocket extends win.EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    readonly bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    readyState = 0;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      win.setTimeout(() => this.#finish(1006, false), 0);
    }

    send(): void {
      if (this.readyState === 0) throw new win.DOMException("The socket is still connecting.", "InvalidStateError");
    }

    close(code = 1000): void {
      this.#finish(code, true);
    }

    #finish(code: number, clean: boolean): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (!clean) this.#emit(new win.Event("error"));
      this.#emit(new win.CloseEvent("close", { code, wasClean: clean }));
    }

    #emit(event: Event): void {
      const handler = (this as unknown as Record<string, unknown>)[`on${event.type}`];
      if (typeof handler === "function") (handler as (event: Event) => void).call(this, event);
      this.dispatchEvent(event);
    }
  };
}
