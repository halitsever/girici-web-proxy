import express, { Router, type NextFunction, type Request, type Response } from "express";
import { issueSession, sessionFromRequest } from "../auth/cookie.ts";
import type { AdminInfo, AuthStore } from "../auth/store.ts";
import { isOwnHost } from "../http/origin.ts";
import { MAX_BLOCKED_HOSTS, normalizeHostEntry, type HostBlocklist } from "../upstream/blocklist.ts";

const MIN_PASSWORD = 8;

export interface AdminSettings {
  public: boolean;
  blockedHosts: string[];
  envBlockedHosts: string[];
}

/** Account and operator settings for the signed-in admin; changes are same-origin and authed only. */
export function adminRouter(store: AuthStore, blocklist: HostBlocklist): Router {
  const router = Router();
  const json = express.json({ limit: "8kb" });
  // A full blocklist of long host names outgrows the small-form limit.
  const settingsJson = express.json({ limit: "512kb" });

  router.post("/_g/account", json, sameOrigin, requireSession(store), (req, res) => {
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
      issueSession(req, res, admin.id, store.sessionSecret());
    }
    res.json({ admin: store.admin() });
  });

  // Browsers send no Origin on same-origin GETs; the SameSite session cookie and no CORS headers keep this private.
  router.get("/_g/admin/settings", requireSession(store), (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(settingsOf(store, blocklist));
  });

  router.post("/_g/admin/settings", settingsJson, sameOrigin, requireSession(store), (req, res) => {
    const body = req.body as { publicAccess?: unknown; blockedHosts?: unknown };
    const hasPublic = body?.publicAccess !== undefined;
    const hasHosts = body?.blockedHosts !== undefined;
    if ((!hasPublic && !hasHosts) || (hasPublic && typeof body.publicAccess !== "boolean")) {
      res.status(400).end();
      return;
    }
    let hosts: string[] | null = null;
    if (hasHosts) {
      const result = readHostList(body.blockedHosts);
      if ("invalid" in result) {
        res.status(400).json({ invalid: result.invalid });
        return;
      }
      hosts = result.hosts;
    }
    if (hasPublic) store.setPublicAccess(body.publicAccess === true);
    if (hosts) {
      store.setBlockedHosts(hosts);
      blocklist.update(hosts);
    }
    res.json(settingsOf(store, blocklist));
  });

  return router;
}

/** All or nothing: one bad entry leaves the saved list untouched. */
function readHostList(value: unknown): { hosts: string[] } | { invalid: string[] } {
  if (!Array.isArray(value) || value.length > MAX_BLOCKED_HOSTS) return { invalid: [] };
  const hosts = new Set<string>();
  const invalid: string[] = [];
  for (const entry of value) {
    const host = typeof entry === "string" ? normalizeHostEntry(entry) : null;
    if (host) hosts.add(host);
    else invalid.push(String(entry));
  }
  return invalid.length > 0 ? { invalid } : { hosts: [...hosts] };
}

function settingsOf(store: AuthStore, blocklist: HostBlocklist): AdminSettings {
  return { public: store.publicAccess(), blockedHosts: blocklist.stored(), envBlockedHosts: blocklist.env() };
}

function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!isOwnHost(req.get("origin"), req.get("host"))) {
    res.status(403).end();
    return;
  }
  next();
}

function requireSession(store: AuthStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
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
