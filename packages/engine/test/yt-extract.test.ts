import { describe, expect, it } from "vitest";
import { isYtPlayer, spliceDirectStreams } from "../src/sw/yt-extract.ts";
import type { Transport, TransportResult } from "../src/sw/transport.ts";

function altTransport(alt: unknown): { transport: Transport; sent: () => Record<string, unknown> } {
  let body: Record<string, unknown> = {};
  const transport: Transport = {
    async send(request) {
      body = JSON.parse(await request.text()) as Record<string, unknown>;
      const result: TransportResult = {
        ok: true,
        response: { status: 200, headers: [], setCookies: [], body: new Response(JSON.stringify(alt)).body },
      };
      return result;
    },
  };
  return { transport, sent: () => body };
}

function playerRequest(body: unknown): { bytes: ArrayBuffer; request: Request } {
  const text = JSON.stringify(body);
  const request = new Request("https://proxy.test/~/https/www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "x-youtube-client-name": "1", "x-youtube-client-version": "2.0" },
    body: text,
  });
  return { bytes: new TextEncoder().encode(text).buffer, request };
}

const WEB = JSON.stringify({
  streamingData: { serverAbrStreamingUrl: "https://sabr", adaptiveFormats: [{ itag: 1 }], formats: [{ itag: 18 }] },
  videoDetails: { videoId: "B1" },
});

describe("isYtPlayer", () => {
  it("matches only the YouTube player endpoint host", () => {
    expect(isYtPlayer(new URL("https://www.youtube.com/youtubei/v1/player"))).toBe(true);
    expect(isYtPlayer(new URL("https://evil.test/youtubei/v1/player"))).toBe(false);
    expect(isYtPlayer(new URL("https://www.youtube.com/watch"))).toBe(false);
  });
});

describe("spliceDirectStreams", () => {
  const body = { context: { client: { clientName: "WEB", visitorData: "VD" } }, videoId: "B1", serviceIntegrityDimensions: { poToken: "WEBTOK" } };

  it("swaps to MWEB, carries a minted poToken, drops SABR and progressive", async () => {
    const alt = { streamingData: { serverAbrStreamingUrl: "x", adaptiveFormats: [{ itag: 251 }], formats: [{ itag: 18 }] } };
    const { transport, sent } = altTransport(alt);
    const { bytes, request } = playerRequest(body);

    const result = await spliceDirectStreams(bytes, WEB, request, new URL("https://www.youtube.com/youtubei/v1/player"), null, null, transport, async () => "POT123");

    expect(sent().context).toMatchObject({ client: { clientName: "MWEB" } });
    expect(sent().serviceIntegrityDimensions).toEqual({ poToken: "POT123" });
    const out = JSON.parse(result!) as { streamingData: Record<string, unknown> };
    expect(out.streamingData.serverAbrStreamingUrl).toBeUndefined();
    expect(out.streamingData.formats).toBeUndefined();
    expect(out.streamingData.adaptiveFormats).toEqual([{ itag: 251 }]);
  });

  it("drops the WEB poToken and proceeds when minting returns null", async () => {
    const alt = { streamingData: { adaptiveFormats: [{ itag: 251 }] } };
    const { transport, sent } = altTransport(alt);
    const { bytes, request } = playerRequest(body);

    const result = await spliceDirectStreams(bytes, WEB, request, new URL("https://www.youtube.com/youtubei/v1/player"), null, null, transport, async () => null);

    expect(sent().serviceIntegrityDimensions).toBeUndefined();
    expect(result).not.toBeNull();
  });

  it("falls back when the alt request fails at the relay", async () => {
    const transport: Transport = { async send() { return { ok: false, code: "connect", status: 502 }; } };
    const { bytes, request } = playerRequest(body);

    const result = await spliceDirectStreams(bytes, WEB, request, new URL("https://www.youtube.com/youtubei/v1/player"), null, null, transport, async () => "POT123");

    expect(result).toBeNull();
  });

  it("falls back when the alt response has no streamingData", async () => {
    const { transport } = altTransport({ playabilityStatus: { status: "ERROR" } });
    const { bytes, request } = playerRequest(body);

    const result = await spliceDirectStreams(bytes, WEB, request, new URL("https://www.youtube.com/youtubei/v1/player"), null, null, transport, async () => "POT123");

    expect(result).toBeNull();
  });
});
