import type { Request, Response } from "express";
import { signSession, verifySession, type SessionPayload } from "./session.ts";

export const SESSION_COOKIE = "__Host-girici";
/** Safari drops Secure cookies set by plain-http pages, localhost included, so those pages get this one instead. */
export const PLAIN_SESSION_COOKIE = "girici-session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Sign a session token for an admin id, valid for SESSION_TTL_MS from now. */
export function createSessionToken(sub: number, secret: string, now = Date.now()): string {
  return signSession({ sub, iat: now, exp: now + SESSION_TTL_MS }, secret);
}

/** The first valid session in a Cookie header, or null when every token is missing, expired or unsigned. */
export function readSession(cookieHeader: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  const cookies = parseCookies(cookieHeader);
  for (const name of [SESSION_COOKIE, PLAIN_SESSION_COOKIE]) {
    const token = cookies[name];
    const payload = token ? verifySession(token, secret, now) : null;
    if (payload) return payload;
  }
  return null;
}

/**
 * A page served over https gets the __Host- cookie, which must be Secure. A plain-http page, such as a local
 * http://localhost, gets an unprefixed one without Secure, since Safari would drop the Secure one there.
 */
export function issueSession(req: Request, res: Response, sub: number, secret: string): void {
  const token = createSessionToken(sub, secret);
  const options = { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS } as const;
  if (servedOverHttps(req)) res.cookie(SESSION_COOKIE, token, { ...options, secure: true });
  else res.cookie(PLAIN_SESSION_COOKIE, token, options);
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  res.clearCookie(PLAIN_SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

/** The page's own scheme, from the Origin these same-origin POSTs carry; a TLS terminator hides it from req. */
export function servedOverHttps(req: Request): boolean {
  return URL.parse(req.get("origin") ?? "")?.protocol === "https:";
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}
