import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const SEAL_TTL_MS = 60_000;

const IV_BYTES = 12;
const TAG_BYTES = 16;

interface SealPayload {
  t: string;
  o: string;
  c: string | null;
  e: number;
}

function sealKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "girici", "ws-seal", 32));
}

/** Encrypts what the relay will send upstream, so the page that carries the seal cannot read the cookie in it. */
export function sealWsHandshake(
  secret: string,
  input: { target: URL; origin: string; cookie: string | null },
  now = Date.now(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const payload: SealPayload = { t: input.target.origin, o: input.origin, c: input.cookie, e: now + SEAL_TTL_MS };
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/** The sealed Origin and cookie, or null for junk, another key, an expired seal or a different target. */
export function openWsSeal(
  secret: string,
  sealed: unknown,
  target: URL,
  now = Date.now(),
): { origin: string; cookie: string | null } | null {
  if (typeof sealed !== "string") return null;
  let payload: Partial<SealPayload>;
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealKey(secret), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const text = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
    payload = JSON.parse(text.toString("utf8")) as Partial<SealPayload>;
  } catch {
    return null;
  }
  if (payload.t !== target.origin || typeof payload.e !== "number" || payload.e < now) return null;
  if (typeof payload.o !== "string" || (payload.c !== null && typeof payload.c !== "string")) return null;
  return { origin: payload.o, cookie: payload.c };
}
