import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionPayload {
  sub: number;
  iat: number;
  exp: number;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** A stateless `body.signature` token; the signature is HMAC-SHA256 over the body. */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

/** Return the payload when the signature and expiry hold, else null. */
export function verifySession(token: string, secret: string, now = Date.now()): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(body, secret));
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  return payload;
}
