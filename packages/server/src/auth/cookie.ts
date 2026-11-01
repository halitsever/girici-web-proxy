import type { SiteDomain } from "@girici/engine/shared";
import type { Request, Response } from "express";
import { signSession, verifySession, type SessionPayload } from "./session.ts";

export const SESSION_COOKIE = "__Host-girici";
/** Safari drops Secure cookies set by plain-http pages, localhost included, so those pages get this one instead. */
export const PLAIN_SESSION_COOKIE = "girici-session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `__Host-` cannot carry Domain=, which the site session needs to reach every site host. */
export const SITE_SESSION_COOKIE = "__Secure-girici-site";
export const PLAIN_SITE_SESSION_COOKIE = "girici-site";
/** Keeps the site session off page loads, which the service worker answers anyway. */
const SITE_SESSION_PATH = "/_g/";

/** Sign a session token for an admin id, valid for SESSION_TTL_MS from now. */
export function createSessionToken(sub: number, secret: string, now = Date.now()): string {
  return signSession({ sub, iat: now, exp: now + SESSION_TTL_MS }, secret);
}

/** Like `createSessionToken`, for the cookie site hosts receive; it never opens the admin API. */
export function createSiteSessionToken(sub: number, secret: string, now = Date.now()): string {
  return signSession({ sub, iat: now, exp: now + SESSION_TTL_MS, aud: "site" }, secret);
}

/** The first valid admin session in a Cookie header, or null when every token is missing, expired or unsigned. */
export function readSession(cookieHeader: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  return firstSession(cookieHeader, [SESSION_COOKIE, PLAIN_SESSION_COOKIE], undefined, secret, now);
}

/** The first valid site session; an admin token under a site cookie's name does not count. */
export function readSiteSession(
  cookieHeader: string | undefined,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  return firstSession(cookieHeader, [SITE_SESSION_COOKIE, PLAIN_SITE_SESSION_COOKIE], "site", secret, now);
}

function firstSession(
  cookieHeader: string | undefined,
  names: readonly string[],
  aud: SessionPayload["aud"],
  secret: string,
  now: number,
): SessionPayload | null {
  const cookies = parseCookies(cookieHeader);
  for (const name of names) {
    const token = cookies[name];
    const payload = token ? verifySession(token, secret, now) : null;
    if (payload && payload.aud === aud) return payload;
  }
  return null;
}

/**
 * A page served over https gets the __Host- cookie, which must be Secure. A plain-http page, such as a local
 * http://localhost, gets an unprefixed one without Secure, since Safari would drop the Secure one there. In subdomain
 * mode the site session for every host under the domain follows the same rule.
 */
export function issueSession(req: Request, res: Response, sub: number, secret: string, siteDomain?: SiteDomain): void {
  const https = servedOverHttps(req);
  const token = createSessionToken(sub, secret);
  const options = { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS } as const;
  if (https) res.cookie(SESSION_COOKIE, token, { ...options, secure: true });
  else res.cookie(PLAIN_SESSION_COOKIE, token, options);
  if (!siteDomain) return;
  const site = createSiteSessionToken(sub, secret);
  const siteOptions = { ...options, domain: siteDomain.host, path: SITE_SESSION_PATH };
  if (https) res.cookie(SITE_SESSION_COOKIE, site, { ...siteOptions, secure: true });
  else res.cookie(PLAIN_SITE_SESSION_COOKIE, site, siteOptions);
}

export function clearSession(res: Response, siteDomain?: SiteDomain): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
  res.clearCookie(PLAIN_SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  if (!siteDomain) return;
  const siteOptions = { httpOnly: true, sameSite: "lax", domain: siteDomain.host, path: SITE_SESSION_PATH } as const;
  res.clearCookie(SITE_SESSION_COOKIE, { ...siteOptions, secure: true });
  res.clearCookie(PLAIN_SITE_SESSION_COOKIE, siteOptions);
}

/** The page's own scheme, from the Origin these same-origin POSTs carry; a TLS terminator hides it from req. */
function servedOverHttps(req: Request): boolean {
  return URL.parse(req.get("origin") ?? "")?.protocol === "https:";
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
