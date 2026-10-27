import { Router } from "express";

/** Holds the proxy paths, including v1's /proxy/ links, until the engine lands. */
export function proxyUnavailableRouter(): Router {
  const router = Router();
  router.all(["/~", "/~/{*rest}", "/proxy/{*rest}"], (_req, res) => {
    res.status(503).set("Cache-Control", "no-store").type("text/plain").send("Proxy engine is not available yet.");
  });
  return router;
}
