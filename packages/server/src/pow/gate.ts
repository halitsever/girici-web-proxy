import type { RequestHandler, Response } from "express";
import { isAdminCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { cookieValues } from "../http/cookie-values.ts";
import { sendRelayError } from "../http/relay-error.ts";
import type { UpgradeGate } from "../ws/relay-ws.ts";
import { issueVisitor, powKey, readVisitor, VISITOR_RENEW_MS, VISITOR_TTL_MS } from "./tokens.ts";

export const VISITOR_COOKIE = "__Host-girici-visitor";
/** Safari drops Secure cookies set by plain-http pages, so those pages get this one, as with the session. */
export const PLAIN_VISITOR_COOKIE = "girici-visitor";

export interface PowGateOptions {
  store: AuthStore;
  now?: () => number;
}

export function setVisitorCookie(res: Response, name: string, token: string): void {
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_TTL_MS,
    secure: name === VISITOR_COOKIE,
  });
}

/** The first visitor cookie that verifies for this client, with the name it came under. */
function visitorOf(
  key: Buffer,
  cookieHeader: string | undefined,
  client: string,
  now: number,
): { name: string; iat: number } | null {
  for (const name of [VISITOR_COOKIE, PLAIN_VISITOR_COOKIE]) {
    for (const token of cookieValues(cookieHeader, [name])) {
      const visitor = readVisitor(key, token, client, now);
      if (visitor) return { name, iat: visitor.iat };
    }
  }
  return null;
}

/** Sits behind authGate, so on a private instance only the admin gets here, and the admin is exempt. */
export function powGate({ store, now = Date.now }: PowGateOptions): RequestHandler {
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
      if (at - visitor.iat > VISITOR_RENEW_MS) setVisitorCookie(res, visitor.name, issueVisitor(key, client, at));
      next();
      return;
    }
    if (isAdminCookie(store, req.headers.cookie)) {
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
    if (visitor || isAdminCookie(store, req.headers.cookie)) return null;
    return { code: "challenge", status: 403 };
  };
}
