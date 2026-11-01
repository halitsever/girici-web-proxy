import type { RequestHandler } from "express";
import { isSessionCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import type { Logger } from "../log.ts";
import { clientKey, type TrustFn } from "./client-ip.ts";
import type { Limiter } from "./rate-limit.ts";
import { sendRelayError } from "./relay-error.ts";

/** Caps proxy requests per client. The admin is never limited, so the session is checked only once the bucket says no. */
export function relayLimit({ limiter, store }: { limiter: Limiter | null; store: AuthStore }): RequestHandler {
  return (req, res, next) => {
    if (!limiter) {
      next();
      return;
    }
    const result = limiter(clientKey(req.ip ?? "?"));
    if (result.ok || isSessionCookie(store, req.headers.cookie)) {
      next();
      return;
    }
    res.setHeader("Retry-After", String(result.retryAfter));
    sendRelayError(res, "rate_limited", 429);
  };
}

/** Behind an untrusted reverse proxy every visitor shares the proxy's address, and so one rate-limit bucket. */
export function warnUntrustedForwarding(trust: TrustFn, logger: Logger): RequestHandler {
  let warned = false;
  return (req, _res, next) => {
    if (!warned && req.headers["x-forwarded-for"] && !trust(req.socket.remoteAddress ?? "", 0)) {
      warned = true;
      logger.warn(
        "Requests arrive with X-Forwarded-For but GIRICI_TRUST_PROXY is off. Behind a reverse proxy, set it to the " +
          "number of proxies in front of Girici, or every visitor shares one rate limit.",
      );
    }
    next();
  };
}
