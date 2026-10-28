import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { AuthStore } from "./auth/store.ts";
import { loadConfig, type Config } from "./config.ts";
import { openDb } from "./db/open.ts";
import { createHttpServer } from "./http/server.ts";
import { createLogger } from "./log.ts";
import { engineBundlesDir, webDistDir } from "./paths.ts";
import { createUpstreamAgent } from "./upstream/agent.ts";
import { createGuardedLookup } from "./upstream/ssrf.ts";
import { createPoTokenMinter } from "./youtube/botguard-session.ts";
import { attachWsRelay } from "./ws/relay-ws.ts";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const logger = createLogger(config.logLevel);

let authStore: AuthStore;
try {
  mkdirSync(config.dataDir, { recursive: true });
  authStore = new AuthStore(openDb(join(config.dataDir, "girici.db")), config.sessionSecret);
} catch (error) {
  logger.error(`Cannot open the database in ${config.dataDir}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
if (!existsSync(join(webDistDir, "index.html"))) {
  logger.warn("Web UI is not built; / returns 503 until you run npm run build");
}
if (!existsSync(join(engineBundlesDir, "sw.js"))) {
  logger.warn("Proxy engine is not built; proxied pages cannot load until you run npm run build");
}
if (config.testUpstreams.size > 0) {
  logger.warn(`Test mode: upstream mapping active for ${[...config.testUpstreams.keys()].join(", ")}`);
}

const agent = createUpstreamAgent({
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
    trustProxy: config.trustProxy,
    relay: { agent, allowedTestHosts: new Set(config.testUpstreams.keys()), maxRequestBody: 50 * 1024 * 1024 },
    // Lazy: BotGuard only runs on the first poToken request, so this costs nothing at startup.
    poToken: config.youtubePoToken ? createPoTokenMinter() : undefined,
  }),
);
attachWsRelay(server, {
  allowedTestHosts: new Set(config.testUpstreams.keys()),
  lookup: createGuardedLookup(),
  logger,
  authStore,
});
server.on("error", (error) => {
  logger.error(error.message);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  logger.info(`Girici listening on http://${config.host}:${config.port}`);
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
