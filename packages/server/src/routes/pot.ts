import express, { Router, type Request, type Response } from "express";
import { isOwnHost } from "../http/origin.ts";
import { rateLimiter } from "../http/rate-limit.ts";

/** A poToken source; the real one is the BotGuard-backed minter. */
export interface PoTokenSource {
  mint(contentBinding: string): Promise<string | null>;
}

export interface PoRouterOptions {
  minter: PoTokenSource;
  rateLimit?: { windowMs: number; max: number };
}

/** Mints a GVS poToken for the caller. Same-origin only, rate-limited, so a proxied page cannot farm tokens. */
export function poRouter(options: PoRouterOptions): Router {
  // Exact paths only: the service worker guards these by name, so a variant such as /_g/Logout/ must miss too.
  const router = Router({ caseSensitive: true, strict: true });
  const allow = rateLimiter(options.rateLimit ?? { windowMs: 60_000, max: 120 });
  router.post("/_g/pot", express.json({ limit: "8kb" }), async (req: Request, res: Response) => {
    if (!isOwnHost(req.get("origin"), req.get("host"))) {
      res.status(403).end();
      return;
    }
    if (!allow(req.ip ?? "?")) {
      res.status(429).end();
      return;
    }
    const binding = (req.body as { contentBinding?: unknown })?.contentBinding;
    if (typeof binding !== "string" || !binding) {
      res.status(400).end();
      return;
    }
    // A binding or token in logs would leak the viewer's session; never logged.
    const poToken = await options.minter.mint(binding);
    res.setHeader("Cache-Control", "no-store");
    res.json({ poToken });
  });
  return router;
}
