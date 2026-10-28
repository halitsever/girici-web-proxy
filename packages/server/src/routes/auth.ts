import express, { Router, type Request, type Response } from "express";
import { clearSession, issueSession, sessionFromRequest } from "../auth/cookie.ts";
import type { AuthStore } from "../auth/store.ts";
import { isOwnHost } from "../http/origin.ts";
import { rateLimiter } from "../http/rate-limit.ts";

export interface AuthRouterOptions {
  loginMax?: number;
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
  const router = Router();
  const json = express.json({ limit: "8kb" });
  const allowSetup = rateLimiter({ windowMs: 60_000, max: 5 });
  const allowLogin = rateLimiter({ windowMs: 60_000, max: options.loginMax ?? 5 });

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
    const creds = readCredentials(req.body);
    if (!creds) {
      res.status(400).end();
      return;
    }
    const admin = store.createAdmin(creds);
    issueSession(res, admin.id, store.sessionSecret());
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
    issueSession(res, admin.id, store.sessionSecret());
    res.json(state(store, true));
  });

  router.post("/_g/logout", (req, res) => {
    if (!isOwnHost(req.get("origin"), req.get("host"))) {
      res.status(403).end();
      return;
    }
    clearSession(res);
    res.status(204).end();
  });

  return router;
}

interface AuthState {
  setup: boolean;
  authed: boolean;
  public: boolean;
  admin?: { username: string; name: string; email: string };
}

function isAuthed(store: AuthStore, req: Request): boolean {
  const admin = store.admin();
  return admin !== null && sessionFromRequest(req, store.sessionSecret()) === admin.id;
}

function state(store: AuthStore, authed: boolean): AuthState {
  const admin = store.admin();
  return {
    setup: admin === null,
    authed,
    public: store.publicAccess(),
    admin: authed && admin ? { username: admin.username, name: admin.name, email: admin.email } : undefined,
  };
}

/** Same-origin plus rate limit; writes the status and returns false when the request should stop. */
function guard(req: Request, res: Response, allow: (key: string) => boolean): boolean {
  if (!isOwnHost(req.get("origin"), req.get("host"))) {
    res.status(403).end();
    return false;
  }
  if (!allow(req.ip ?? "?")) {
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
