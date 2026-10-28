import type { Realm } from "./url-context.ts";

// WebRTC can expose the user's real address, and these two transports have no relay.
// WebSocket is not here: it is replaced by the relay shim in installWebSocket.
const REMOVED = ["RTCPeerConnection", "webkitRTCPeerConnection", "WebSocketStream", "WebTransport"];

/** Remove the realtime APIs Girici cannot safely proxy, so a page falls back instead of leaking around it. */
export function installRealtimeBlock(win: Realm): void {
  for (const name of REMOVED) Reflect.deleteProperty(win, name);
}
