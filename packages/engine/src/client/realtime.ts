import type { Realm } from "./url-context.ts";

const deleteProperty = Reflect.deleteProperty;

// WebRTC can expose the user's real address, and these two transports have no relay.
// WebSocket is not here: pages and workers both get the relay shim from installWebSocket.
const REMOVED = ["RTCPeerConnection", "webkitRTCPeerConnection", "WebSocketStream", "WebTransport"];

/** Remove the realtime APIs Girici cannot safely proxy, so a page falls back instead of leaking around it. */
export function installRealtimeBlock(win: Realm): void {
  // Indexed: adopting a frame runs this inside a page call, after the page may have replaced the array iterator.
  for (let index = 0; index < REMOVED.length; index++) deleteProperty(win, REMOVED[index] as string);
}
