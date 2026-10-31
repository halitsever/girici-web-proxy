import express, { Router, type NextFunction, type Request, type Response } from "express";
import { clearSession, issueSession } from "../auth/cookie.ts";
import { sessionAdmin } from "../auth/gate.ts";
import { generateSetupCode, setupCodeMatches } from "../auth/setup-code.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import { rateLimiter } from "../http/rate-limit.ts";

export interface AuthRouterOptions {
  loginMax?: number;
  /** The code the server printed at startup; without one, setup takes a code nobody has. */
  setupToken?: string;
}

interface Credentials {
  username: string;
  name: string;
  email: string;
  password: string;
}

const MIN_PASSWORD = 8;

/** Setup, login, logout and the state the SPA guard reads. State-changing routes are same-origin only. */
export function authRouter(store: AuthStore, options: AuthRouterOptions = {}): Router {
  // Exact paths only: the service worker guards these by name, so a variant such as /_g/Logout/ must miss too.
  const router = Router({ caseSensitive: true, strict: true });
  const json = express.json({ limit: "8kb" });
  const allowSetup = rateLimiter({ windowMs: 60_000, max: 5 });
  const allowLogin = rateLimiter({ windowMs: 60_000, max: options.loginMax ?? 5 });
  const setupCode = options.setupToken ?? generateSetupCode();

  router.get("/_g/auth/state", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(state(store, isAuthed(store, req)));
  });

  router.post("/_g/setup", json, (req, res) => {
    if (!guard(req, res, allowSetup)) return;
    if (store.hasAdmin()) {
      res.status(409).end();
      return;
    }
    // Whoever reaches a fresh instance first would otherwise own it; the code proves access to the server log.
    if (!setupCodeMatches((req.body as { setupToken?: unknown } | undefined)?.setupToken, setupCode)) {
      res.status(403).end();
      return;
    }
    const creds = readCredentials(req.body);
    if (!creds) {
      res.status(400).end();
      return;
    }
    const admin = store.createAdmin(creds);
    issueSession(req, res, admin.id, store.sessionSecret());
    res.json(state(store, true));
  });

  router.post("/_g/login", json, (req, res) => {
    if (!guard(req, res, allowLogin)) return;
    const body = req.body as { username?: unknown; password?: unknown };
    if (typeof body?.username !== "string" || typeof body?.password !== "string") {
      res.status(400).end();
      return;
    }
    const admin = store.verifyLogin(body.username, body.password);
    if (!admin) {
      res.status(401).end();
      return;
    }
    issueSession(req, res, admin.id, store.sessionSecret());
    res.json(state(store, true));
  });

  const ownOrigin = (req: Request, res: Response, next: NextFunction) => {
    if (isOwnHost(req.get("origin"), req.get("host"))) next();
    else res.status(403).end();
  };
  router.post("/_g/logout", ownOrigin, express.json({ limit: "1kb" }), (req, res) => {
    // Revoking needs a live session, so a stray request cannot sign the admin out of every device.
    const everywhere = (req.body as { everywhere?: unknown } | undefined)?.everywhere === true;
    if (everywhere && sessionAdmin(store, req.headers.cookie)) store.revokeSessions();
    clearSession(res);
    res.status(204).end();
  });

  return router;
}

interface AuthState {
  setup: boolean;
  authed: boolean;
  public: boolean;
  sealAddresses: boolean;
  admin?: { username: string; name: string; email: string };
}

function isAuthed(store: AuthStore, req: Request): boolean {
  return sessionAdmin(store, req.headers.cookie) !== null;
}

function state(store: AuthStore, authed: boolean): AuthState {
  const admin = store.admin();
  return {
    setup: admin === null,
    authed,
    public: store.publicAccess(),
    sealAddresses: store.sealAddresses(),
    admin: authed && admin ? { username: admin.username, name: admin.name, email: admin.email } : undefined,
  };
}

/** Same-origin plus rate limit; writes the status and returns false when the request should stop. */
function guard(req: Request, res: Response, allow: (key: string) => boolean): boolean {
  if (!isOwnHost(req.get("origin"), req.get("host"))) {
    res.status(403).end();
    return false;
  }
  if (!allow(clientKey(req.ip ?? "?"))) {
    res.status(429).end();
    return false;
  }
  return true;
}

function readCredentials(body: unknown): Credentials | null {
  const value = body as Partial<Record<keyof Credentials, unknown>>;
  const username = str(value?.username);
  const name = str(value?.name);
  const email = str(value?.email);
  const password = typeof value?.password === "string" ? value.password : "";
  if (!username || !name || !email.includes("@") || password.length < MIN_PASSWORD) return null;
  return { username, name, email, password };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
