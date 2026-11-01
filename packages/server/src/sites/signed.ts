import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 in base64url is always this long, whatever the key. */
const MAC_LENGTH = 43;

/** `base64url(JSON).base64url(HMAC)`; the purpose is signed too, so a value made for one job fails every other. */
export function signValue(key: Buffer, purpose: string, payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(key, purpose, body)}`;
}

/** The payload when the signature holds, else null. */
export function openValue(key: Buffer, purpose: string, value: string): unknown {
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(key, purpose, body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as unknown;
  } catch {
    return null;
  }
}

/** The length `signValue` gives for this payload. */
export function signedLength(payload: unknown): number {
  return Buffer.from(JSON.stringify(payload)).toString("base64url").length + 1 + MAC_LENGTH;
}

function mac(key: Buffer, purpose: string, body: string): string {
  return createHmac("sha256", key).update(`${purpose}\0${body}`).digest("base64url");
}
