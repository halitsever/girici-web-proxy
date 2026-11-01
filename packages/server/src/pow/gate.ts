import type { SiteDomain } from "@girici/engine/shared";
import type { RequestHandler, Response } from "express";
import { isSessionCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { cookieValues } from "../http/cookie-values.ts";
import { sendRelayError } from "../http/relay-error.ts";
import type { UpgradeGate } from "../ws/relay-ws.ts";
import { issueVisitor, powKey, readVisitor, VISITOR_RENEW_MS, VISITOR_TTL_MS } from "./tokens.ts";

export const VISITOR_COOKIE = "__Host-girici-visitor";
/** `__Host-` cannot carry Domain=, which the cookie needs to reach every site host in subdomain mode. */
export const SITE_VISITOR_COOKIE = "__Secure-girici-visitor";
/** Safari drops Secure cookies set by plain-http pages, so those pages get this one, as with the session. */
export const PLAIN_VISITOR_COOKIE = "girici-visitor";

export interface PowGateOptions {
  store: AuthStore;
  now?: () => number;
  /** Subdomain mode, where the root issues the cookie and the site hosts' relays read it. */
  siteDomain?: SiteDomain;
}

/** The name a cookie for this page's scheme takes. */
export function visitorCookieName(https: boolean, siteDomain?: SiteDomain): string {
  if (!https) return PLAIN_VISITOR_COOKIE;
  return siteDomain ? SITE_VISITOR_COOKIE : VISITOR_COOKIE;
}

export function setVisitorCookie(res: Response, name: string, token: string, siteDomain?: SiteDomain): void {
  // Kept off page loads on site hosts, as the site session is; every relay path is under /_g/.
  const scope = siteDomain ? { domain: siteDomain.host, path: "/_g/" } : { path: "/" };
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: "lax",
    ...scope,
    maxAge: VISITOR_TTL_MS,
    secure: name !== PLAIN_VISITOR_COOKIE,
  });
}

/** The first visitor cookie that verifies for this client, with the name it came under. */
function visitorOf(
  key: Buffer,
  cookieHeader: string | undefined,
  client: string,
  now: number,
): { name: string; iat: number } | null {
  for (const name of [VISITOR_COOKIE, SITE_VISITOR_COOKIE, PLAIN_VISITOR_COOKIE]) {
    for (const token of cookieValues(cookieHeader, [name])) {
      const visitor = readVisitor(key, token, client, now);
      if (visitor) return { name, iat: visitor.iat };
    }
  }
  return null;
}

/** Sits behind authGate, so on a private instance only the admin gets here, and the admin is exempt. */
export function powGate({ store, now = Date.now, siteDomain }: PowGateOptions): RequestHandler {
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
        const name = visitorCookieName(visitor.name !== PLAIN_VISITOR_COOKIE, siteDomain);
        setVisitorCookie(res, name, issueVisitor(key, client, at), siteDomain);
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
