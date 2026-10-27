import express, { type Express } from "express";
import { errorHandler } from "./http/error-handler.ts";
import { securityHeaders } from "./http/security-headers.ts";
import { serviceWorkerScriptGuard } from "./http/sw-script-guard.ts";
import type { Logger } from "./log.ts";
import { bootstrapRouter } from "./routes/bootstrap.ts";
import { engineRouter } from "./routes/engine.ts";
import { healthRouter } from "./routes/health.ts";
import { legacyRouter } from "./routes/legacy.ts";
import { relayRouter, type RelayOptions } from "./routes/relay.ts";
import { robotsRouter } from "./routes/robots.ts";
import { sourceRouter } from "./routes/source.ts";
import { uiRouter } from "./routes/ui.ts";

export interface AppOptions {
  webDistDir: string;
  engineBundlesDir: string;
  sourceUrl: string;
  logger: Logger;
  relay: Omit<RelayOptions, "logger">;
}

export function createApp({ webDistDir, engineBundlesDir, sourceUrl, logger, relay }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders());
  app.use(serviceWorkerScriptGuard());
  app.use(healthRouter());
  app.use(robotsRouter());
  app.use(sourceRouter(sourceUrl));
  app.use(relayRouter({ ...relay, logger }));
  app.use(uiRouter(webDistDir));
  app.use(engineRouter(engineBundlesDir));
  app.use(bootstrapRouter());
  app.use(legacyRouter());
  app.use(errorHandler(logger));
  return app;
}
