import express, { Router, type NextFunction, type Request, type Response } from "express";
import { issueSession } from "../auth/cookie.ts";
import { sessionAdmin } from "../auth/gate.ts";
import type { AdminInfo, AuthStore } from "../auth/store.ts";
import { readLogoUpload } from "../brand/logo.ts";
import { readBrandName } from "../brand/name.ts";
import type { BrandStore } from "../brand/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import { rateLimiter } from "../http/rate-limit.ts";
import { MAX_BLOCKED_HOSTS, normalizeHostEntry, type HostBlocklist } from "../upstream/blocklist.ts";

const MIN_PASSWORD = 8;

export interface AdminSettings {
  public: boolean;
  blockedHosts: string[];
  envBlockedHosts: string[];
  sealAddresses: boolean;
}

/** Account and operator settings for the signed-in admin; changes need same origin, a session and the password. */
export function adminRouter(store: AuthStore, blocklist: HostBlocklist, brand: BrandStore): Router {
  // Exact paths only: the service worker guards these by name, so a variant such as /_g/Logout/ must miss too.
  const router = Router({ caseSensitive: true, strict: true });
  const json = express.json({ limit: "8kb" });
  // A full blocklist of long host names outgrows the small-form limit.
  const settingsJson = express.json({ limit: "512kb" });
  // A 256 KB logo is about 350 KB as base64.
  const brandJson = express.json({ limit: "384kb" });
  // Each write checks a password, so attempts are capped per client the way sign-ins are.
  const confirm = confirmPassword(store, rateLimiter({ windowMs: 60_000, max: 10 }));

  router.post("/_g/account", sameOrigin, requireSession(store), json, confirm, (req, res) => {
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

  router.post("/_g/admin/settings", sameOrigin, requireSession(store), settingsJson, confirm, (req, res) => {
    const body = req.body as { publicAccess?: unknown; blockedHosts?: unknown; sealAddresses?: unknown };
    const hasPublic = body?.publicAccess !== undefined;
    const hasHosts = body?.blockedHosts !== undefined;
    const hasSeal = body?.sealAddresses !== undefined;
    if (
      (!hasPublic && !hasHosts && !hasSeal) ||
      (hasPublic && typeof body.publicAccess !== "boolean") ||
      (hasSeal && typeof body.sealAddresses !== "boolean")
    ) {
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
    if (hasSeal) store.setSealAddresses(body.sealAddresses === true);
    if (hosts) {
      store.setBlockedHosts(hosts);
      blocklist.update(hosts);
    }
    res.json(settingsOf(store, blocklist));
  });

  router.post("/_g/admin/brand", sameOrigin, requireSession(store), brandJson, confirm, (req, res) => {
    const body = (req.body ?? {}) as { name?: unknown; logo?: unknown };
    const hasName = "name" in body;
    const hasLogo = "logo" in body;
    if (!hasName && !hasLogo) {
      res.status(400).end();
      return;
    }
    const name = hasName ? readBrandName(body.name) : undefined;
    if (name === null) {
      res.status(400).json({ invalid: "name" });
      return;
    }
    const logo = hasLogo && body.logo !== null ? readLogoUpload(body.logo) : undefined;
    if (logo === null) {
      res.status(400).json({ invalid: "logo" });
      return;
    }
    res.json(brand.update({ ...(name ? { name: name.name } : {}), ...(hasLogo ? { logo: logo ?? null } : {}) }));
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
  return {
    public: store.publicAccess(),
    blockedHosts: blocklist.stored(),
    envBlockedHosts: blocklist.env(),
    sealAddresses: store.sealAddresses(),
  };
}

function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!isOwnHost(req.get("origin"), req.get("host"))) {
    res.status(403).end();
    return;
  }
  next();
}

/** A session alone is not enough to change anything: a page that rides the cookie does not know the password. */
function confirmPassword(store: AuthStore, allow: (key: string) => boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allow(clientKey(req.ip ?? "?"))) {
      res.status(429).end();
      return;
    }
    const given = (req.body as { currentPassword?: unknown } | undefined)?.currentPassword;
    const admin = res.locals.admin as AdminInfo;
    if (typeof given !== "string" || !store.checkPassword(admin.id, given)) {
      res.status(403).end();
      return;
    }
    next();
  };
}

function requireSession(store: AuthStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const admin = sessionAdmin(store, req.headers.cookie);
    if (!admin) {
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
