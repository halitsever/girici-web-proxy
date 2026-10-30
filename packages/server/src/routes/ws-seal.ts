import { WS_SEAL_PATH } from "@girici/engine/shared";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { AuthStore } from "../auth/store.ts";
import { isOwnHost } from "../http/origin.ts";
import { sealWsHandshake } from "../ws/seal.ts";

const MAX_COOKIE = 32 * 1024;

interface SealInput {
  target: URL;
  origin: string;
  cookie: string | null;
}

/** The service worker seals a WebSocket's cookie and Origin here before the page opens the socket. */
export function wsSealRouter(store: AuthStore): Router {
  // Exact paths only: the service worker guards these by name, so a variant such as /_g/Logout/ must miss too.
  const router = Router({ caseSensitive: true, strict: true });
  router.post(WS_SEAL_PATH, ownOrigin, express.json({ limit: "64kb" }), (req, res) => {
    const input = readSealInput(req.body);
    if (!input) {
      res.status(400).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ seal: sealWsHandshake(store.sessionSecret(), input) });
  });
  return router;
}

function ownOrigin(req: Request, res: Response, next: NextFunction): void {
  if (isOwnHost(req.get("origin"), req.get("host"))) next();
  else res.status(403).end();
}

/** The relay puts these straight into upstream headers, so a cookie with line breaks never gets this far. */
function readSealInput(body: unknown): SealInput | null {
  const { url, origin, cookie } = (body ?? {}) as Record<string, unknown>;
  const target = typeof url === "string" ? URL.parse(url) : null;
  if (!target || (target.protocol !== "ws:" && target.protocol !== "wss:")) return null;
  const page = typeof origin === "string" ? URL.parse(origin) : null;
  if (!page || (page.protocol !== "http:" && page.protocol !== "https:") || page.origin !== origin) return null;
  if (cookie !== null && (typeof cookie !== "string" || cookie.length > MAX_COOKIE || /[\r\n\0]/.test(cookie))) {
    return null;
  }
  return { target, origin: page.origin, cookie };
}
