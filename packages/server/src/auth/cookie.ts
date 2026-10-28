import type { Request, Response } from "express";
import { signSession, verifySession } from "./session.ts";

export const SESSION_COOKIE = "__Host-girici";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Sign a session token for an admin id, valid for SESSION_TTL_MS from now. */
export function createSessionToken(sub: number, secret: string, now = Date.now()): string {
  return signSession({ sub, iat: now, exp: now + SESSION_TTL_MS }, secret);
}

/** Read the admin id from a Cookie header, or null when the token is missing, expired or unsigned. */
export function readSessionToken(cookieHeader: string | undefined, secret: string, now = Date.now()): number | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const payload = verifySession(token, secret, now);
  return payload ? payload.sub : null;
}

/** __Host- requires Secure and Path=/; browsers accept it over http to localhost. */
export function issueSession(res: Response, sub: number, secret: string): void {
  res.cookie(SESSION_COOKIE, createSessionToken(sub, secret), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

export function sessionFromRequest(req: Request, secret: string): number | null {
  return readSessionToken(req.headers.cookie, secret);
}

function parseCookies(header: string | undefined): Record<string, string> {
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
