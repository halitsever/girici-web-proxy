import { HEADER } from "@girici/engine/shared";
import type { RequestHandler, Response } from "express";
import { sessionFromRequest } from "./cookie.ts";
import type { AuthStore } from "./store.ts";

/** Guards the proxy data path: open when public, else a valid session for the current admin. */
export function authGate(store: AuthStore): RequestHandler {
  return (req, res, next) => {
    if (store.publicAccess()) {
      next();
      return;
    }
    const sub = sessionFromRequest(req, store.sessionSecret());
    if (sub !== null && store.admin()?.id === sub) {
      next();
      return;
    }
    failAuth(res);
  };
}

/** The SW turns this into a login redirect for navigations and Response.error() for subresources. */
function failAuth(res: Response): void {
  res.setHeader(HEADER.error, "auth");
  res.setHeader(HEADER.status, "401");
  res.setHeader("Cache-Control", "no-store");
  res.status(401).type("text/plain").send("auth");
}
