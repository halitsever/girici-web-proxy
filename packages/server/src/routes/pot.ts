import express, { Router, type Request, type Response } from "express";

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
  const router = Router();
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

/** Hosts only: behind a TLS terminator the server sees http while the page's Origin says https. */
function isOwnHost(origin: string | undefined, host: string | undefined): boolean {
  const url = origin ? URL.parse(origin) : null;
  return !!url && (url.protocol === "http:" || url.protocol === "https:") && url.host === host?.toLowerCase();
}

function rateLimiter({ windowMs, max }: { windowMs: number; max: number }): (key: string) => boolean {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now >= entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
