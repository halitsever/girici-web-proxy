import { Router } from "express";
import type { AuthStore } from "../auth/store.ts";
import type { Logger } from "../log.ts";

/** Reads the database so an orchestrator restarts a container whose volume went away. */
export function healthRouter(store: AuthStore, logger: Logger): Router {
  const router = Router();
  // Logged on the change only, since the Docker check polls every 30 seconds.
  let failing = false;
  router.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      store.ping();
    } catch (error) {
      if (!failing) logger.error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
      failing = true;
      res.status(503).type("text/plain").send("database unavailable");
      return;
    }
    if (failing) logger.info("Health check passes again");
    failing = false;
    res.type("text/plain").send("ok");
  });
  return router;
}
