import express, { type Express } from "express";
import { errorHandler } from "./http/error-handler.ts";
import { securityHeaders } from "./http/security-headers.ts";
import type { Logger } from "./log.ts";
import { healthRouter } from "./routes/health.ts";
import { proxyUnavailableRouter } from "./routes/proxy-unavailable.ts";
import { robotsRouter } from "./routes/robots.ts";
import { sourceRouter } from "./routes/source.ts";
import { uiRouter } from "./routes/ui.ts";

export interface AppOptions {
  webDistDir: string;
  sourceUrl: string;
  logger: Logger;
}

export function createApp({ webDistDir, sourceUrl, logger }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders());
  app.use(healthRouter());
  app.use(robotsRouter());
  app.use(sourceRouter(sourceUrl));
  app.use(uiRouter(webDistDir));
  app.use(proxyUnavailableRouter());
  app.use(errorHandler(logger));
  return app;
}
