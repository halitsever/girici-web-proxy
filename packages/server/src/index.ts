import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { generateSetupCode, setupBanner } from "./auth/setup-code.ts";
import { AuthStore } from "./auth/store.ts";
import { BrandStore } from "./brand/store.ts";
import { loadConfig, trustProxyWarning, type Config } from "./config.ts";
import { openDb } from "./db/open.ts";
import { compileTrust } from "./http/client-ip.ts";
import { tokenBucket } from "./http/rate-limit.ts";
import { fetch as undiciFetch } from "undici";
import { createHttpServer } from "./http/server.ts";
import { createLogger } from "./log.ts";
import { engineBundlesDir, webDistDir } from "./paths.ts";
import { createTunnelDialer, createUpstreamAgent } from "./upstream/agent.ts";
import { HostBlocklist } from "./upstream/blocklist.ts";
import { describeProxy } from "./upstream/proxy-config.ts";
import { createGuardedLookup } from "./upstream/ssrf.ts";
import { createPoTokenMinter } from "./youtube/botguard-session.ts";
import { attachWsRelay, testUpstreamDial } from "./ws/relay-ws.ts";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const logger = createLogger(config.logLevel);
const trustWarning = trustProxyWarning(config.trustProxy);
if (trustWarning) logger.warn(trustWarning);

let authStore: AuthStore;
try {
  mkdirSync(config.dataDir, { recursive: true });
  authStore = new AuthStore(openDb(join(config.dataDir, "girici.db")), config.sessionSecret);
} catch (error) {
  logger.error(
    `Cannot open the database in ${config.dataDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
if (!existsSync(join(webDistDir, "index.html"))) {
  logger.warn("Web UI is not built; / returns 503 until you run npm run build");
}
if (!existsSync(join(engineBundlesDir, "sw.js"))) {
  logger.warn("Proxy engine is not built; proxied pages cannot load until you run npm run build");
}
if (config.upstreamProxy) {
  logger.info(`Upstream proxy: ${describeProxy(config.upstreamProxy)}`);
}
if (config.testUpstreams.size > 0) {
  logger.warn(`Test mode: upstream mapping active for ${[...config.testUpstreams.keys()].join(", ")}`);
}

// One trust function and one bucket serve both relays, so a client cannot double its budget over WebSockets.
const trust = compileTrust(config.trustProxy);
const limiter = config.rateLimit > 0 ? tokenBucket({ perMinute: config.rateLimit }) : null;
const blocklist = new HostBlocklist(config.blockedHosts, authStore.blockedHosts());
// A fresh code at every start until setup is done, unless the operator fixed one.
const setupCode = config.setupToken ?? generateSetupCode();
const agent = createUpstreamAgent({
  proxy: config.upstreamProxy,
  testUpstreams: config.testUpstreams,
  testCa: config.testCaPath ? readFileSync(config.testCaPath, "utf8") : undefined,
});
const server = createHttpServer(
  createApp({
    webDistDir,
    engineBundlesDir,
    sourceUrl: config.sourceUrl,
    logger,
    authStore,
    brand: new BrandStore(join(config.dataDir, "brand"), authStore),
    trust,
    limiter,
    blocklist,
    setupToken: setupCode,
    relay: {
      agent,
      allowedTestHosts: new Set(config.testUpstreams.keys()),
      maxRequestBody: 50 * 1024 * 1024,
      blocklist,
    },
    // Lazy: BotGuard only runs on the first poToken request, so this costs nothing at startup. It leaves through the
    // relay's agent so tokens and media share one egress IP, with or without an upstream proxy.
    poToken: config.youtubePoToken
      ? createPoTokenMinter(
          (input, init) =>
            undiciFetch(input, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>,
        )
      : undefined,
  }),
);
const wsLookup = createGuardedLookup();
const testCa = config.testCaPath ? readFileSync(config.testCaPath, "utf8") : undefined;
attachWsRelay(server, {
  dial:
    config.testUpstreams.size > 0 && !config.upstreamProxy ? testUpstreamDial(config.testUpstreams, testCa) : undefined,
  allowedTestHosts: new Set(config.testUpstreams.keys()),
  lookup: wsLookup,
  tunnel: config.upstreamProxy
    ? createTunnelDialer(config.upstreamProxy, {
        lookup: wsLookup,
        testUpstreams: config.testUpstreams,
        timeout: 10_000,
      })
    : undefined,
  logger,
  authStore,
  trust,
  limiter,
  blocklist,
});
server.on("error", (error) => {
  logger.error(error.message);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  logger.info(`Girici listening on http://${config.host}:${config.port}`);
  if (!authStore.hasAdmin()) process.stdout.write(setupBanner(setupCode, config.setupToken !== undefined));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      authStore.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    // A hung request must not keep a container from stopping.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
