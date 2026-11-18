import { describe, expect, it } from "vitest";
import {
  carriesPlayer,
  isSabrRequest,
  SabrStreams,
  SabrTokens,
  streamVideos,
  videoIdOf,
  withPoToken,
} from "../src/sw/yt-sabr.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
/** A length-delimited protobuf field with a one-byte key and length. */
const field = (number: number, payload: Uint8Array) => bytes(number * 8 + 2, payload.length, ...payload);
const varintField = (number: number, value: number) => bytes(number * 8, value);
const join = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));
/** Field 19 needs a two-byte key: 19 * 8 + 2 = 154. */
const streamerContext = (payload: Uint8Array) => bytes(0x9a, 0x01, payload.length, ...payload);

describe("isSabrRequest", () => {
  it("matches the player's POST to a googlevideo videoplayback URL", () => {
    const url = new URL("https://rr3---sn-abc.googlevideo.com/videoplayback?sabr=1");
    expect(isSabrRequest(url, "POST")).toBe(true);
    expect(isSabrRequest(url, "GET")).toBe(false);
    expect(isSabrRequest(new URL("https://evilgooglevideo.com/videoplayback"), "POST")).toBe(false);
    expect(isSabrRequest(new URL("https://rr3.googlevideo.com/initplayback"), "POST")).toBe(false);
  });
});

describe("withPoToken", () => {
  const token = bytes(9, 9, 9);

  it("replaces the poToken inside streamerContext and keeps every other field", () => {
    const context = join(field(1, bytes(7)), field(2, bytes(1, 2, 3, 4, 5)), varintField(5, 3));
    const body = join(varintField(1, 4), streamerContext(context), field(5, bytes(8, 8)));
    const out = withPoToken(body, token);
    expect(out).toEqual(
      join(
        varintField(1, 4),
        streamerContext(join(field(1, bytes(7)), varintField(5, 3), field(2, token))),
        field(5, bytes(8, 8)),
      ),
    );
  });

  it("adds a poToken when the player sent none", () => {
    const body = join(streamerContext(field(1, bytes(7))));
    expect(withPoToken(body, token)).toEqual(streamerContext(join(field(1, bytes(7)), field(2, token))));
  });

  it("leaves bodies it cannot read alone", () => {
    expect(withPoToken(join(varintField(1, 4)), token)).toBeNull();
    expect(withPoToken(bytes(0x0a, 0x7f, 1), token)).toBeNull();
  });
});

describe("videoIdOf", () => {
  it("reads the video from watch, embed and shorts pages", () => {
    expect(videoIdOf(new URL("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3"))).toBe("aqz-KE-bpKQ");
    expect(videoIdOf(new URL("https://www.youtube.com/embed/aqz-KE-bpKQ?autoplay=1"))).toBe("aqz-KE-bpKQ");
    expect(videoIdOf(new URL("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"))).toBe("aqz-KE-bpKQ");
    expect(videoIdOf(new URL("https://m.youtube.com/shorts/aqz-KE-bpKQ"))).toBe("aqz-KE-bpKQ");
  });

  it("ignores other pages and other sites", () => {
    expect(videoIdOf(new URL("https://www.youtube.com/"))).toBeNull();
    expect(videoIdOf(new URL("https://www.youtube.com/watch?v=short"))).toBeNull();
    expect(videoIdOf(new URL("https://example.com/watch?v=aqz-KE-bpKQ"))).toBeNull();
    expect(videoIdOf(null)).toBeNull();
  });
});

describe("SabrTokens", () => {
  it("mints once per video and decodes the websafe token", async () => {
    const calls: string[] = [];
    const tokens = new SabrTokens(async (video) => {
      calls.push(video);
      return "-_8";
    });
    const [first, second] = await Promise.all([tokens.get("aqz-KE-bpKQ"), tokens.get("aqz-KE-bpKQ")]);
    expect(first).toEqual(bytes(0xfb, 0xff));
    expect(second).toBe(first);
    expect(calls).toEqual(["aqz-KE-bpKQ"]);
  });

  it("retries a refusal after a minute and a token after half an hour", async () => {
    let now = 0;
    let answer: string | null = null;
    let calls = 0;
    const tokens = new SabrTokens(
      async () => {
        calls++;
        return answer;
      },
      () => now,
    );
    expect(await tokens.get("aqz-KE-bpKQ")).toBeNull();
    answer = "AAAA";
    now = 30_000;
    expect(await tokens.get("aqz-KE-bpKQ")).toBeNull();
    now = 61_000;
    expect(await tokens.get("aqz-KE-bpKQ")).toEqual(bytes(0, 0, 0));
    now += 29 * 60_000;
    await tokens.get("aqz-KE-bpKQ");
    expect(calls).toBe(2);
    now += 2 * 60_000;
    await tokens.get("aqz-KE-bpKQ");
    expect(calls).toBe(3);
  });

  it("treats a failed mint as no token", async () => {
    const tokens = new SabrTokens(async () => {
      throw new Error("offline");
    });
    expect(await tokens.get("aqz-KE-bpKQ")).toBeNull();
  });
});

/** A player response as YouTube serialises it: streamingData first, videoDetails later. */
const player = (stream: string, video: string) =>
  JSON.stringify({
    streamingData: {
      serverAbrStreamingUrl: `https://rr1---sn-x.googlevideo.com/videoplayback?expire=1&id=${stream}&sabr=1&c=WEB`,
    },
    playerAds: [{ title: "x" }],
    videoDetails: { videoId: video, title: "t" },
  });

describe("streamVideos", () => {
  it("pairs each stream with the video of its own player response", () => {
    const answer = JSON.stringify([
      { playerResponse: JSON.parse(player("o-main", "aqz-KE-bpKQ")) },
      { watchNextResponse: { videoDetails: { comments: [] } } },
    ]);
    expect(streamVideos(answer)).toEqual([["o-main", "aqz-KE-bpKQ"]]);
  });

  it("reads ad player responses that travel percent-encoded", () => {
    const ad = `player_response=${encodeURIComponent(player("o-ad", "MHs9DuY2mT8"))}`;
    const answer = JSON.stringify({ main: JSON.parse(player("o-main", "aqz-KE-bpKQ")), adPlacements: [{ ad }] });
    expect(streamVideos(answer)).toEqual([
      ["o-main", "aqz-KE-bpKQ"],
      ["o-ad", "MHs9DuY2mT8"],
    ]);
  });

  it("skips a stream whose own response names no video", () => {
    const orphan = JSON.stringify({ streamingData: { serverAbrStreamingUrl: "https://a.googlevideo.com/v?id=o-1" } });
    expect(streamVideos(orphan + player("o-2", "aqz-KE-bpKQ"))).toEqual([["o-2", "aqz-KE-bpKQ"]]);
  });
});

describe("carriesPlayer", () => {
  it("covers watch pages and the InnerTube calls that answer with a player response", () => {
    expect(carriesPlayer(new URL("https://www.youtube.com/watch?v=aqz-KE-bpKQ"))).toBe(true);
    expect(carriesPlayer(new URL("https://www.youtube.com/youtubei/v1/get_watch?prettyPrint=false"))).toBe(true);
    expect(carriesPlayer(new URL("https://www.youtube.com/youtubei/v1/player"))).toBe(true);
    expect(carriesPlayer(new URL("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"))).toBe(true);
    expect(carriesPlayer(new URL("https://www.youtube.com/youtubei/v1/log_event"))).toBe(false);
    expect(carriesPlayer(new URL("https://www.youtube.com/watchlater"))).toBe(false);
    expect(carriesPlayer(new URL("https://example.com/watch"))).toBe(false);
  });
});

describe("SabrStreams", () => {
  const body = (text: string) => new Response(text).body!;

  it("answers a lookup once the page that named the stream has arrived", async () => {
    const streams = new SabrStreams();
    streams.learnFrom(body(player("o-main", "aqz-KE-bpKQ")));
    expect(await streams.videoOf("o-main")).toBe("aqz-KE-bpKQ");
    expect(await streams.videoOf("o-other")).toBeNull();
  });

  it("forgets the oldest streams first", () => {
    const streams = new SabrStreams();
    for (let index = 0; index < 70; index++) streams.learn(player(`o-${index}`, "aqz-KE-bpKQ"));
    return Promise.all([streams.videoOf("o-0"), streams.videoOf("o-69")]).then(([oldest, newest]) => {
      expect(oldest).toBeNull();
      expect(newest).toBe("aqz-KE-bpKQ");
    });
  });
});
