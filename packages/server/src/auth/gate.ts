import type { RequestHandler } from "express";
import { sendRelayError } from "../http/relay-error.ts";
import { readSession, readSiteSession } from "./cookie.ts";
import type { SessionPayload } from "./session.ts";
import type { AdminInfo, AuthStore } from "./store.ts";

/** The current admin when the Cookie header carries their session and it was issued after the last revocation. */
export function sessionAdmin(store: AuthStore, cookieHeader: string | undefined, now = Date.now()): AdminInfo | null {
  return currentAdmin(store, readSession(cookieHeader, store.sessionSecret(), now));
}

/** The same check for the site session, which lets the admin browse but never opens the admin API. */
export function siteSessionAdmin(
  store: AuthStore,
  cookieHeader: string | undefined,
  now = Date.now(),
): AdminInfo | null {
  return currentAdmin(store, readSiteSession(cookieHeader, store.sessionSecret(), now));
}

/** True when the Cookie header carries a valid session for the current admin. */
export function isAdminCookie(store: AuthStore, cookieHeader: string | undefined): boolean {
  return sessionAdmin(store, cookieHeader) !== null;
}

/** Either session lets the admin browse; only `sessionAdmin` may change anything. */
export function isSessionCookie(store: AuthStore, cookieHeader: string | undefined): boolean {
  return isAdminCookie(store, cookieHeader) || siteSessionAdmin(store, cookieHeader) !== null;
}

function currentAdmin(store: AuthStore, payload: SessionPayload | null): AdminInfo | null {
  const admin = store.admin();
  if (!payload || !admin || payload.sub !== admin.id) return null;
  // Tokens from before revocation existed carry iat too; a token without one is treated as the oldest.
  const issued = typeof payload.iat === "number" ? payload.iat : 0;
  return issued >= store.sessionsValidAfter() ? admin : null;
}

/** Guards the proxy data path: open when public, else a valid session for the current admin. */
export function authGate(store: AuthStore): RequestHandler {
  return (req, res, next) => {
    if (store.publicAccess() || isSessionCookie(store, req.headers.cookie)) {
      next();
      return;
    }
    // The SW turns this into a login redirect for navigations and Response.error() for subresources.
    sendRelayError(res, "auth", 401);
  };
}
