import { WS_SEAL_PATH } from "@girici/engine/shared";
import express, { type Express, type RequestHandler, type Router } from "express";
import { authGate } from "./auth/gate.ts";
import type { AuthStore } from "./auth/store.ts";
import type { BrandStore } from "./brand/store.ts";
import { compileTrust, type TrustFn } from "./http/client-ip.ts";
import { errorHandler } from "./http/error-handler.ts";
import type { Limiter } from "./http/rate-limit.ts";
import { relayLimit, warnUntrustedForwarding } from "./http/relay-limit.ts";
import { NO_OBSERVER, relayAnswers, type RelayObserver } from "./http/relay-observer.ts";
import { securityHeaders } from "./http/security-headers.ts";
import { serviceWorkerScriptGuard } from "./http/sw-script-guard.ts";
import type { Logger } from "./log.ts";
import { adminRouter } from "./routes/admin.ts";
import { authRouter } from "./routes/auth.ts";
import { bootstrapRouter } from "./routes/bootstrap.ts";
import { brandRouter } from "./routes/brand.ts";
import { engineRouter } from "./routes/engine.ts";
import { healthRouter } from "./routes/health.ts";
import { legacyRouter } from "./routes/legacy.ts";
import { poRouter, type PoTokenSource } from "./routes/pot.ts";
import { relayRouter, type RelayOptions } from "./routes/relay.ts";
import { robotsRouter } from "./routes/robots.ts";
import { sourceRouter } from "./routes/source.ts";
import { uiRouter } from "./routes/ui.ts";
import { wsSealRouter } from "./routes/ws-seal.ts";
import { HostBlocklist } from "./upstream/blocklist.ts";

export interface AppOptions {
  webDistDir: string;
  engineBundlesDir: string;
  sourceUrl: string;
  logger: Logger;
  authStore: AuthStore;
  brand: BrandStore;
  trust?: TrustFn;
  limiter?: Limiter | null;
  blocklist?: HostBlocklist;
  relay: Omit<RelayOptions, "logger">;
  poToken?: PoTokenSource;
  setupToken?: string;
  observer?: RelayObserver;
  powGate?: RequestHandler;
  bandwidthGate?: RequestHandler;
  metricsRouter?: Router;
  statusRouter?: Router;
  powRouter?: Router;
}

const pass: RequestHandler = (_req, _res, next) => next();

export function createApp({
  webDistDir,
  engineBundlesDir,
  sourceUrl,
  logger,
  authStore,
  brand,
  trust,
  limiter,
  blocklist,
  relay,
  poToken,
  setupToken,
  observer = NO_OBSERVER,
  powGate = pass,
  bandwidthGate = pass,
  metricsRouter,
  statusRouter,
  powRouter,
}: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // req.ip (the rate-limit key) comes from X-Forwarded-For when this trusts the proxy. Behind a proxy
  // set it to the hop count, not true: true trusts a client-spoofable header and defeats the limits.
  const trustFn = trust ?? compileTrust(false);
  app.set("trust proxy", trustFn);
  app.use(securityHeaders());
  app.use(serviceWorkerScriptGuard());
  app.use(healthRouter(authStore, logger));
  if (metricsRouter) app.use(metricsRouter);
  app.use(robotsRouter());
  app.use(sourceRouter(sourceUrl));
  app.use(brandRouter(brand));
  app.use(authRouter(authStore, { setupToken }));
  app.use(adminRouter(authStore, blocklist ?? new HostBlocklist([], authStore.blockedHosts()), brand));
  if (statusRouter) app.use(statusRouter);
  // Ungated: a visitor the browser check refuses must still reach the check.
  if (powRouter) app.use(powRouter);
  // First on the data path, so the observer hears every gate's refusal as well as the relay's own answers.
  app.use("/_g/r", relayAnswers(observer));
  // Gate the proxy data path, the poToken minter and WebSocket seals; navigations reach the SW as an auth error
  // and redirect to login. Public access opens them; nothing else here is gated.
  app.use(["/_g/r", "/_g/pot", WS_SEAL_PATH], authGate(authStore), powGate);
  app.use(
    "/_g/r",
    warnUntrustedForwarding(trustFn, logger),
    relayLimit({ limiter: limiter ?? null, store: authStore }),
    bandwidthGate,
  );
  if (poToken) app.use(poRouter({ minter: poToken }));
  app.use(wsSealRouter(authStore));
  app.use(relayRouter({ ...relay, logger, observer }));
  app.use(uiRouter(webDistDir, authStore));
  app.use(engineRouter(engineBundlesDir));
  app.use(bootstrapRouter());
  app.use(legacyRouter());
  // Express's own 404 page swaps in a CSP without frame-ancestors.
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not Found");
  });
  app.use(errorHandler(logger));
  return app;
}
