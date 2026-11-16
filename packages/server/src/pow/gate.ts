import type { SiteDomain } from "@girici/engine/shared";
import type { RequestHandler, Response } from "express";
import { parseCookies } from "../auth/cookie.ts";
import { isSessionCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { sendRelayError } from "../http/relay-error.ts";
import type { UpgradeGate } from "../ws/relay-ws.ts";
import { issueVisitor, powKey, readVisitor, VISITOR_RENEW_MS, VISITOR_TTL_MS } from "./tokens.ts";

export const VISITOR_COOKIE = "__Host-girici-visitor";
/** Subdomain mode shares the cookie with every site host, and `__Host-` forbids the Domain attribute that takes. */
export const SITE_VISITOR_COOKIE = "__Secure-girici-visitor";
/** Safari drops Secure cookies set by plain-http pages, so those pages get this one, as with the session. */
export const PLAIN_VISITOR_COOKIE = "girici-visitor";

export interface PowGateOptions {
  store: AuthStore;
  /** Subdomain mode, where the root solves the check and the site hosts send the cookie. */
  siteDomain?: SiteDomain;
  now?: () => number;
}

/** The cookie name for a page served over `https`, given the mode. */
export function visitorCookieName(https: boolean, siteDomain: SiteDomain | undefined): string {
  if (!https) return PLAIN_VISITOR_COOKIE;
  return siteDomain ? SITE_VISITOR_COOKIE : VISITOR_COOKIE;
}

export function setVisitorCookie(res: Response, name: string, token: string, siteDomain?: SiteDomain): void {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_TTL_MS,
    secure: name !== PLAIN_VISITOR_COOKIE,
    ...(siteDomain && name !== VISITOR_COOKIE ? { domain: siteDomain.host } : {}),
  });
}

/** The first visitor cookie that verifies for this client, with the name it came under. */
function visitorOf(
  key: Buffer,
  cookieHeader: string | undefined,
  client: string,
  now: number,
): { name: string; iat: number } | null {
  const cookies = parseCookies(cookieHeader);
  for (const name of [VISITOR_COOKIE, SITE_VISITOR_COOKIE, PLAIN_VISITOR_COOKIE]) {
    const token = cookies[name];
    const visitor = token ? readVisitor(key, token, client, now) : null;
    if (visitor) return { name, iat: visitor.iat };
  }
  return null;
}

/** Sits behind authGate, so on a private instance only the admin gets here, and the admin is exempt. */
export function powGate({ store, siteDomain, now = Date.now }: PowGateOptions): RequestHandler {
  return (req, res, next) => {
    if (!store.proofOfWork()) {
      next();
      return;
    }
    const at = now();
    const key = powKey(store.sessionSecret());
    const client = clientKey(req.ip ?? "?");
    const visitor = visitorOf(key, req.headers.cookie, client, at);
    if (visitor) {
      // Renewed on use, so a visitor who keeps browsing is not checked again every day.
      if (at - visitor.iat > VISITOR_RENEW_MS) {
        setVisitorCookie(res, visitor.name, issueVisitor(key, client, at), siteDomain);
      }
      next();
      return;
    }
    if (isSessionCookie(store, req.headers.cookie)) {
      next();
      return;
    }
    sendRelayError(res, "challenge", 403);
  };
}

/** The same rule before a WebSocket upgrade, whose key is already the client's. */
export function powUpgradeGate({ store, now = Date.now }: PowGateOptions): UpgradeGate {
  return (req, key) => {
    if (!store.proofOfWork()) return null;
    const visitor = visitorOf(powKey(store.sessionSecret()), req.headers.cookie, key, now());
    if (visitor || isSessionCookie(store, req.headers.cookie)) return null;
    return { code: "challenge", status: 403 };
  };
}
