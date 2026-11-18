// YouTube's web player streams over SABR: protobuf POSTs to googlevideo that carry a GVS poToken bound to the video.
// Through a proxy the page's own BotGuard attestation fails and googlevideo stops serving after about a minute, so the
// worker puts a server-minted token in each request.

/** A SABR request: the player's POST to a googlevideo videoplayback URL. */
export function isSabrRequest(target: URL, method: string): boolean {
  const host = target.hostname;
  return (
    method === "POST" &&
    (host.endsWith(".googlevideo.com") || host === "googlevideo.com") &&
    target.pathname === "/videoplayback"
  );
}

const STREAMER_CONTEXT = 19;
const PO_TOKEN = 2;

interface Field {
  number: number;
  wire: number;
  start: number;
  end: number;
  payloadStart: number;
}

function readVarint(bytes: Uint8Array, at: number): [value: number, next: number] {
  let value = 0;
  let scale = 1;
  let index = at;
  for (;;) {
    if (index >= bytes.length || index - at > 9) throw new RangeError("bad varint");
    const byte = bytes[index++]!;
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return [value, index];
    scale *= 128;
  }
}

function writeVarint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function fields(bytes: Uint8Array): Field[] {
  const out: Field[] = [];
  let index = 0;
  while (index < bytes.length) {
    const start = index;
    const [key, afterKey] = readVarint(bytes, index);
    const wire = key & 7;
    let payloadStart = afterKey;
    if (wire === 0) index = readVarint(bytes, afterKey)[1];
    else if (wire === 1) index = afterKey + 8;
    else if (wire === 5) index = afterKey + 4;
    else if (wire === 2) {
      const [length, afterLength] = readVarint(bytes, afterKey);
      payloadStart = afterLength;
      index = afterLength + length;
    } else throw new RangeError(`unsupported wire type ${wire}`);
    if (index > bytes.length) throw new RangeError("truncated field");
    out.push({ number: Math.floor(key / 8), wire, start, end: index, payloadStart });
  }
  return out;
}

function lengthDelimited(number: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = [...writeVarint(number * 8 + 2), ...writeVarint(payload.length)];
  const out = new Uint8Array(head.length + payload.length);
  out.set(head);
  out.set(payload, head.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The request with streamerContext.poToken set to token; null when the body is not a SABR request we can read. */
export function withPoToken(body: Uint8Array, token: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let top: Field[];
  try {
    top = fields(body);
  } catch {
    return null;
  }
  let replaced = false;
  const parts = top.map((field) => {
    const raw = body.subarray(field.start, field.end);
    if (field.number !== STREAMER_CONTEXT || field.wire !== 2) return raw;
    const context = body.subarray(field.payloadStart, field.end);
    let inner: Field[];
    try {
      inner = fields(context);
    } catch {
      return raw;
    }
    const kept = inner.filter((part) => part.number !== PO_TOKEN).map((part) => context.subarray(part.start, part.end));
    replaced = true;
    return lengthDelimited(STREAMER_CONTEXT, concat([...kept, lengthDelimited(PO_TOKEN, token)]));
  });
  return replaced ? concat(parts) : null;
}

function fromWebsafeBase64(text: string): Uint8Array {
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(plain + "=".repeat((4 - (plain.length % 4)) % 4)), (char) => char.charCodeAt(0));
}

const VIDEO_ID = /^[\w-]{11}$/;

function isYouTube(host: string): boolean {
  return ["youtube.com", "youtube-nocookie.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The video a YouTube page shows, used when the stream itself was never seen. */
export function videoIdOf(page: URL | null): string | null {
  if (!page || !isYouTube(page.hostname)) return null;
  const query = page.searchParams.get("v");
  if (page.pathname === "/watch") return query && VIDEO_ID.test(query) ? query : null;
  const path = /^\/(?:embed|shorts|live)\/([\w-]{11})(?:[/?]|$)/.exec(page.pathname);
  return path ? path[1]! : null;
}

/** YouTube pages and InnerTube answers that can hold a player response. */
export function carriesPlayer(target: URL): boolean {
  if (!isYouTube(target.hostname)) return false;
  return /^\/(?:watch$|embed\/|shorts\/|live\/|youtubei\/v1\/(?:player|get_watch|next|reel\/))/.test(target.pathname);
}

/** The `id` a googlevideo URL names its stream by. */
export function streamIdOf(url: URL): string | null {
  return url.searchParams.get("id");
}

interface PlayerForm {
  stream: RegExp;
  video: RegExp;
  /** The JSON string body of the captured URL. */
  url(captured: string): string;
}

// Ad player responses travel percent-encoded inside the main answer.
const PLAYER_FORMS: PlayerForm[] = [
  {
    stream: /"serverAbrStreamingUrl":"([^"]+)"/g,
    video: /"videoDetails":\{"videoId":"([\w-]{11})"/g,
    url: (captured) => captured,
  },
  {
    stream: /%22serverAbrStreamingUrl%22%3A%22(.+?)%22/g,
    video: /%22videoDetails%22%3A%7B%22videoId%22%3A%22([\w-]{11})%22/g,
    url: (captured) => decodeURIComponent(captured),
  },
];

/** Each SABR stream in a page or API answer with its video. A player response lists streamingData before videoDetails. */
export function streamVideos(text: string): [streamId: string, videoId: string][] {
  const out: [string, string][] = [];
  for (const form of PLAYER_FORMS) {
    const streams = [...text.matchAll(form.stream)];
    const details = [...text.matchAll(form.video)];
    streams.forEach((stream, index) => {
      const end = streams[index + 1]?.index ?? text.length;
      const video = details.find((detail) => detail.index > stream.index && detail.index < end);
      if (!video) return;
      try {
        const id = streamIdOf(new URL(JSON.parse(`"${form.url(stream[1]!)}"`) as string));
        if (id) out.push([id, video[1]!]);
      } catch {
        // A URL we cannot read leaves that stream to the page address.
      }
    });
  }
  return out;
}

const MAX_STREAMS = 64;
// A page's player asks for its stream right after the page arrives, so a lookup waits briefly for answers in flight.
const LEARN_WAIT_MS = 3_000;

/** Which video each googlevideo stream plays, learned from the player responses the worker relays. */
export class SabrStreams {
  readonly #videos = new Map<string, string>();
  readonly #pending = new Set<Promise<void>>();

  learn(text: string): void {
    for (const [stream, video] of streamVideos(text)) {
      this.#videos.delete(stream);
      this.#videos.set(stream, video);
      if (this.#videos.size > MAX_STREAMS) this.#videos.delete(this.#videos.keys().next().value!);
    }
  }

  /** Learn from a response body copy without holding up the response itself. */
  learnFrom(body: ReadableStream<Uint8Array>): void {
    const done: Promise<void> = new Response(body)
      .text()
      .then(
        (text) => {
          if (text.includes("serverAbrStreamingUrl")) this.learn(text);
        },
        () => {},
      )
      .finally(() => this.#pending.delete(done));
    this.#pending.add(done);
  }

  async videoOf(streamId: string): Promise<string | null> {
    const known = this.#videos.get(streamId);
    if (known || this.#pending.size === 0) return known ?? null;
    await Promise.race([Promise.all(this.#pending), new Promise((resolve) => setTimeout(resolve, LEARN_WAIT_MS))]);
    return this.#videos.get(streamId) ?? null;
  }
}

// A refusal is retried soon, so a server that starts minting is picked up mid-session.
const TOKEN_TTL_MS = 30 * 60_000;
const REFUSAL_TTL_MS = 60_000;
const MAX_VIDEOS = 32;

/** Server-minted GVS poTokens by video, so a playback's many SABR requests share one /_g/pot call. */
export class SabrTokens {
  readonly #mint: (videoId: string) => Promise<string | null>;
  readonly #now: () => number;
  readonly #tokens = new Map<string, { token: Promise<Uint8Array | null>; at: number }>();

  constructor(mint: (videoId: string) => Promise<string | null>, now: () => number = Date.now) {
    this.#mint = mint;
    this.#now = now;
  }

  async get(videoId: string): Promise<Uint8Array | null> {
    const cached = this.#tokens.get(videoId);
    if (cached && this.#now() - cached.at < TOKEN_TTL_MS) {
      const token = await cached.token;
      if (token || this.#now() - cached.at < REFUSAL_TTL_MS) return token;
    }
    this.#tokens.delete(videoId);
    const token = this.#mint(videoId).then(
      (minted) => (minted ? fromWebsafeBase64(minted) : null),
      () => null,
    );
    this.#tokens.set(videoId, { token, at: this.#now() });
    // Maps iterate in insertion order, so the first key is the oldest.
    if (this.#tokens.size > MAX_VIDEOS) this.#tokens.delete(this.#tokens.keys().next().value!);
    return token;
  }
}
