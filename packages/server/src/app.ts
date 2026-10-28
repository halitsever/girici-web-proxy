import express, { type Express } from "express";
import { authGate } from "./auth/gate.ts";
import type { AuthStore } from "./auth/store.ts";
import { errorHandler } from "./http/error-handler.ts";
import { securityHeaders } from "./http/security-headers.ts";
import { serviceWorkerScriptGuard } from "./http/sw-script-guard.ts";
import type { Logger } from "./log.ts";
import { adminRouter } from "./routes/admin.ts";
import { authRouter } from "./routes/auth.ts";
import { bootstrapRouter } from "./routes/bootstrap.ts";
import { engineRouter } from "./routes/engine.ts";
import { healthRouter } from "./routes/health.ts";
import { legacyRouter } from "./routes/legacy.ts";
import { poRouter, type PoTokenSource } from "./routes/pot.ts";
import { relayRouter, type RelayOptions } from "./routes/relay.ts";
import { robotsRouter } from "./routes/robots.ts";
import { sourceRouter } from "./routes/source.ts";
import { uiRouter } from "./routes/ui.ts";

export interface AppOptions {
  webDistDir: string;
  engineBundlesDir: string;
  sourceUrl: string;
  logger: Logger;
  authStore: AuthStore;
  trustProxy?: boolean | number | string;
  relay: Omit<RelayOptions, "logger">;
  poToken?: PoTokenSource;
}

export function createApp({
  webDistDir,
  engineBundlesDir,
  sourceUrl,
  logger,
  authStore,
  trustProxy,
  relay,
  poToken,
}: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // req.ip (the login rate-limit key) comes from X-Forwarded-For when this is set. Behind a proxy
  // set it to the hop count, not true: true trusts a client-spoofable header and defeats the limit.
  app.set("trust proxy", trustProxy ?? false);
  app.use(securityHeaders());
  app.use(serviceWorkerScriptGuard());
  app.use(healthRouter());
  app.use(robotsRouter());
  app.use(sourceRouter(sourceUrl));
  app.use(authRouter(authStore));
  app.use(adminRouter(authStore));
  // Gate the proxy data path and the poToken minter; navigations reach the SW as an auth error
  // and redirect to login. Public access opens both; nothing else here is gated.
  app.use(["/_g/r", "/_g/pot"], authGate(authStore));
  if (poToken) app.use(poRouter({ minter: poToken }));
  app.use(relayRouter({ ...relay, logger }));
  app.use(uiRouter(webDistDir, authStore));
  app.use(engineRouter(engineBundlesDir));
  app.use(bootstrapRouter());
  app.use(legacyRouter());
  app.use(errorHandler(logger));
  return app;
}
