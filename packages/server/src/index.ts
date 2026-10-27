import { existsSync } from "node:fs";
import { createHttpServer } from "./http/server.ts";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig, type Config } from "./config.ts";
import { createLogger } from "./log.ts";
import { webDistDir } from "./paths.ts";

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const logger = createLogger(config.logLevel);
if (!existsSync(join(webDistDir, "index.html"))) {
  logger.warn("Web UI is not built; / returns 503 until you run npm run build");
}

const server = createHttpServer(createApp({ webDistDir, sourceUrl: config.sourceUrl, logger }));
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
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    // A hung request must not keep a container from stopping.
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
