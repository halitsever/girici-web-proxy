import { WS_SEAL_PATH } from "@girici/engine/shared";
import express, { type Express, type RequestHandler } from "express";
import { authGate } from "./auth/gate.ts";
import type { AuthStore } from "./auth/store.ts";
import type { BrandStore } from "./brand/store.ts";
import { compileTrust, type TrustFn } from "./http/client-ip.ts";
import { errorHandler } from "./http/error-handler.ts";
import type { Limiter } from "./http/rate-limit.ts";
import { relayLimit, warnUntrustedForwarding } from "./http/relay-limit.ts";
import { securityHeaders, siteHeaders } from "./http/security-headers.ts";
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
import { siteHostRouter, siteRootRouter } from "./routes/sites.ts";
import { sourceRouter } from "./routes/source.ts";
import { uiRouter } from "./routes/ui.ts";
import { wsSealRouter } from "./routes/ws-seal.ts";
import { hostKinds, onHosts } from "./sites/hosts.ts";
import type { SiteSetup } from "./sites/keys.ts";
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
  /** Subdomain mode; without it every host gets every route. */
  sites?: SiteSetup;
}

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
  sites,
}: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");
  // req.ip (the rate-limit key) comes from X-Forwarded-For when this trusts the proxy. Behind a proxy
  // set it to the hop count, not true: true trusts a client-spoofable header and defeats the limits.
  const trustFn = trust ?? compileTrust(false);
  app.set("trust proxy", trustFn);
  app.use(securityHeaders());
  app.use(hostKinds(sites?.domain));
  app.use(siteHeaders());
  app.use(serviceWorkerScriptGuard());
  app.use(healthRouter(authStore, logger));
  app.use(robotsRouter());
  // In subdomain mode the root serves people and site hosts serve proxied sites; other hosts get nothing more.
  const root = (handler: RequestHandler) => onHosts(["single", "root"], handler);
  const site = (handler: RequestHandler) => onHosts(["single", "site"], handler);
  if (sites) app.use(onHosts(["root"], siteRootRouter(sites, authStore)));
  app.use(root(sourceRouter(sourceUrl)));
  app.use(root(brandRouter(brand)));
  app.use(root(authRouter(authStore, { setupToken, siteDomain: sites?.domain })));
  app.use(
    root(adminRouter(authStore, blocklist ?? new HostBlocklist([], authStore.blockedHosts()), brand, sites?.domain)),
  );
  // Gate the proxy data path, the poToken minter and WebSocket seals; navigations reach the SW as an auth error
  // and redirect to login. Public access opens them; nothing else here is gated.
  app.use(["/_g/r", "/_g/pot", WS_SEAL_PATH], site(authGate(authStore)));
  app.use(
    "/_g/r",
    site(warnUntrustedForwarding(trustFn, logger)),
    site(relayLimit({ limiter: limiter ?? null, store: authStore })),
  );
  if (poToken) app.use(site(poRouter({ minter: poToken })));
  app.use(site(wsSealRouter(authStore)));
  app.use(site(relayRouter({ ...relay, logger })));
  app.use(root(uiRouter(webDistDir, authStore)));
  if (sites) app.use(onHosts(["site"], siteHostRouter(sites, authStore)));
  app.use(site(engineRouter(engineBundlesDir)));
  app.use(site(bootstrapRouter(sites, authStore)));
  app.use(root(legacyRouter()));
  // Express's own 404 page swaps in a CSP without frame-ancestors.
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not Found");
  });
  app.use(errorHandler(logger));
  return app;
}
