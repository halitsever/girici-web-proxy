import { describe, expect, it } from "vitest";
import { installRealtimeBlock } from "../src/client/realtime.ts";
import type { Realm } from "../src/client/url-context.ts";

describe("installRealtimeBlock", () => {
  it("removes WebRTC and the unrelayed transports but leaves WebSocket for the shim", () => {
    const win = {
      RTCPeerConnection: class {},
      webkitRTCPeerConnection: class {},
      WebSocketStream: class {},
      WebTransport: class {},
      WebSocket: class {},
    } as unknown as Realm;

    installRealtimeBlock(win);

    expect(win.RTCPeerConnection).toBeUndefined();
    expect((win as { webkitRTCPeerConnection?: unknown }).webkitRTCPeerConnection).toBeUndefined();
    expect((win as { WebSocketStream?: unknown }).WebSocketStream).toBeUndefined();
    expect(win.WebTransport).toBeUndefined();
    expect(win.WebSocket).toBeDefined();
  });
});
