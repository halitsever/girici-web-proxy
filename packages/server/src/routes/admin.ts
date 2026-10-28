import express, { Router, type NextFunction, type Request, type Response } from "express";
import { issueSession, sessionFromRequest } from "../auth/cookie.ts";
import type { AdminInfo, AuthStore } from "../auth/store.ts";
import { isOwnHost } from "../http/origin.ts";

const MIN_PASSWORD = 8;

/** Account and operator settings for the signed-in admin; same-origin and authed only. */
export function adminRouter(store: AuthStore): Router {
  const router = Router();
  const json = express.json({ limit: "8kb" });

  router.post("/_g/account", json, requireAdmin(store), (req, res) => {
    const body = req.body as { name?: unknown; email?: unknown; password?: unknown };
    const name = str(body?.name);
    const email = str(body?.email);
    if (!name || !email.includes("@")) {
      res.status(400).end();
      return;
    }
    const changingPassword = body?.password !== undefined;
    if (changingPassword && (typeof body.password !== "string" || body.password.length < MIN_PASSWORD)) {
      res.status(400).end();
      return;
    }
    const admin = res.locals.admin as AdminInfo;
    store.updateProfile(admin.id, name, email);
    if (changingPassword) {
      // Rotates the session secret, so re-issue a cookie to keep this device signed in.
      store.changePassword(admin.id, body.password as string);
      issueSession(res, admin.id, store.sessionSecret());
    }
    res.json({ admin: store.admin() });
  });

  router.post("/_g/admin/settings", json, requireAdmin(store), (req, res) => {
    const body = req.body as { publicAccess?: unknown };
    if (typeof body?.publicAccess !== "boolean") {
      res.status(400).end();
      return;
    }
    store.setPublicAccess(body.publicAccess);
    res.json({ public: store.publicAccess() });
  });

  return router;
}

function requireAdmin(store: AuthStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isOwnHost(req.get("origin"), req.get("host"))) {
      res.status(403).end();
      return;
    }
    const admin = store.admin();
    const sub = sessionFromRequest(req, store.sessionSecret());
    if (!admin || sub !== admin.id) {
      res.status(401).end();
      return;
    }
    res.locals.admin = admin;
    next();
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
