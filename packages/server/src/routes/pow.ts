import { POW_PATH } from "@girici/engine/shared";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { servedOverHttps } from "../auth/cookie.ts";
import type { AuthStore } from "../auth/store.ts";
import { clientKey } from "../http/client-ip.ts";
import { isOwnHost } from "../http/origin.ts";
import { rateLimiter } from "../http/rate-limit.ts";
import { PLAIN_VISITOR_COOKIE, setVisitorCookie, VISITOR_COOKIE } from "../pow/gate.ts";
import {
  issueChallenge,
  issueVisitor,
  meetsDifficulty,
  powKey,
  readChallenge,
  SpentChallenges,
} from "../pow/tokens.ts";

export interface PowRouterOptions {
  store: AuthStore;
  difficulty: number;
  spent?: SpentChallenges;
  now?: () => number;
}

/** Hands out challenges and trades a solved one for the visitor cookie. Ungated, so a refused visitor gets here. */
export function powRouter({
  store,
  difficulty,
  spent = new SpentChallenges(),
  now = Date.now,
}: PowRouterOptions): Router {
  // Exact paths only: the service worker guards these by name, so a variant such as /_g/Pow/ must miss too.
  const router = Router({ caseSensitive: true, strict: true });
  const allowChallenge = rateLimiter({ windowMs: 60_000, max: 30 });
  const allowAnswer = rateLimiter({ windowMs: 60_000, max: 30 });

  router.get(POW_PATH, (req, res) => {
    const client = clientKey(req.ip ?? "?");
    if (!allowChallenge(client)) {
      res.status(429).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ challenge: issueChallenge(powKey(store.sessionSecret()), client, difficulty, now()), difficulty });
  });

  router.post(
    POW_PATH,
    ownOrigin,
    (req, res, next) => {
      if (allowAnswer(clientKey(req.ip ?? "?"))) next();
      else res.status(429).end();
    },
    express.json({ limit: "1kb" }),
    (req, res) => {
      const { challenge, nonce } = (req.body ?? {}) as { challenge?: unknown; nonce?: unknown };
      if (typeof challenge !== "string" || typeof nonce !== "string") {
        res.status(400).end();
        return;
      }
      const at = now();
      const key = powKey(store.sessionSecret());
      const client = clientKey(req.ip ?? "?");
      const read = readChallenge(key, challenge, client, at);
      // The nonce is checked before spending, so a wrong guess does not burn the challenge.
      if (!read || !meetsDifficulty(challenge, nonce, read.difficulty) || !spent.spend(read.id, read.expires, at)) {
        res.status(403).end();
        return;
      }
      setVisitorCookie(
        res,
        servedOverHttps(req) ? VISITOR_COOKIE : PLAIN_VISITOR_COOKIE,
        issueVisitor(key, client, at),
      );
      res.setHeader("Cache-Control", "no-store");
      res.status(204).end();
    },
  );
  return router;
}

function ownOrigin(req: Request, res: Response, next: NextFunction): void {
  if (isOwnHost(req.get("origin"), req.get("host"))) next();
  else res.status(403).end();
}
