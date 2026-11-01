import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CHALLENGE_TTL_MS = 300_000;
export const VISITOR_TTL_MS = 86_400_000;
export const VISITOR_RENEW_MS = 3_600_000;

const NONCE = /^(0|[1-9]\d{0,15})$/;

interface ChallengePayload {
  t: "c";
  k: string;
  d: number;
  e: number;
  r: string;
}

interface VisitorPayload {
  t: "v";
  k: string;
  iat: number;
  exp: number;
}

let memo: { secret: string; key: Buffer } | null = null;

/** Derived from the session secret, so replicas sharing GIRICI_SESSION_SECRET accept each other's cookies. */
export function powKey(sessionSecret: string): Buffer {
  if (memo?.secret !== sessionSecret) {
    memo = { secret: sessionSecret, key: createHmac("sha256", sessionSecret).update("girici/v1 visitor").digest() };
  }
  return memo.key;
}

/** Tokens carry this instead of the address, so a leaked token never reveals who it was issued to. */
function clientTag(key: Buffer, clientKey: string): string {
  return createHmac("sha256", key).update(`client\0${clientKey}`).digest().subarray(0, 16).toString("base64url");
}

function sign(key: Buffer, body: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

function seal(key: Buffer, payload: ChallengePayload | VisitorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(key, body)}`;
}

/** The payload of a token this key signed, else null. */
function open(key: Buffer, token: string): Record<string, unknown> | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(key, body));
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(body, "base64url").toString());
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sameTag(key: Buffer, tag: unknown, clientKey: string): boolean {
  if (typeof tag !== "string") return false;
  const given = Buffer.from(tag);
  const expected = Buffer.from(clientTag(key, clientKey));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function issueChallenge(key: Buffer, clientKey: string, difficulty: number, now = Date.now()): string {
  return seal(key, {
    t: "c",
    k: clientTag(key, clientKey),
    d: difficulty,
    e: now + CHALLENGE_TTL_MS,
    r: randomBytes(16).toString("base64url"),
  });
}

export function readChallenge(
  key: Buffer,
  token: string,
  clientKey: string,
  now = Date.now(),
): { id: string; difficulty: number; expires: number } | null {
  const payload = open(key, token);
  if (!payload || payload.t !== "c" || !sameTag(key, payload.k, clientKey)) return null;
  const { d, e, r } = payload;
  if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 256) return null;
  if (typeof e !== "number" || e < now || typeof r !== "string" || !r) return null;
  return { id: r, difficulty: d, expires: e };
}

export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** The nonce is a plain decimal so the browser's solver and this check hash the same bytes. */
export function meetsDifficulty(token: string, nonce: string, difficulty: number): boolean {
  if (!NONCE.test(nonce)) return false;
  return leadingZeroBits(createHash("sha256").update(`${token}:${nonce}`).digest()) >= difficulty;
}

export function issueVisitor(key: Buffer, clientKey: string, now = Date.now()): string {
  return seal(key, { t: "v", k: clientTag(key, clientKey), iat: now, exp: now + VISITOR_TTL_MS });
}

export function readVisitor(key: Buffer, token: string, clientKey: string, now = Date.now()): { iat: number } | null {
  const payload = open(key, token);
  if (!payload || payload.t !== "v" || !sameTag(key, payload.k, clientKey)) return null;
  const { iat, exp } = payload;
  if (typeof iat !== "number" || typeof exp !== "number" || exp < now) return null;
  return { iat };
}

/** Answered challenges until they expire, so one solve mints one cookie. Kept per replica, in memory. */
export class SpentChallenges {
  readonly #max: number;
  readonly #spent = new Map<string, number>();

  constructor(max = 100_000) {
    this.#max = max;
  }

  /** False for a repeat, or while the set is full of live entries. */
  spend(id: string, expires: number, now = Date.now()): boolean {
    this.#sweep(now);
    if (this.#spent.has(id) || this.#spent.size >= this.#max) return false;
    this.#spent.set(id, expires);
    return true;
  }

  get size(): number {
    return this.#spent.size;
  }

  /** Entries arrive in roughly expiry order, so the head is swept cheaply and the whole set only when full. */
  #sweep(now: number): void {
    for (const [id, expires] of this.#spent) {
      if (expires >= now) break;
      this.#spent.delete(id);
    }
    if (this.#spent.size < this.#max) return;
    for (const [id, expires] of this.#spent) if (expires < now) this.#spent.delete(id);
  }
}
