import type { RequestHandler } from "express";
import { sendRelayError } from "../http/relay-error.ts";
import { readSessionToken } from "./cookie.ts";
import type { AuthStore } from "./store.ts";

/** True when the Cookie header carries a valid session for the current admin. */
export function isAdminCookie(store: AuthStore, cookieHeader: string | undefined): boolean {
  const sub = readSessionToken(cookieHeader, store.sessionSecret());
  return sub !== null && store.admin()?.id === sub;
}

/** Guards the proxy data path: open when public, else a valid session for the current admin. */
export function authGate(store: AuthStore): RequestHandler {
  return (req, res, next) => {
    if (store.publicAccess() || isAdminCookie(store, req.headers.cookie)) {
      next();
      return;
    }
    // The SW turns this into a login redirect for navigations and Response.error() for subresources.
    sendRelayError(res, "auth", 401);
  };
}
