import type { RequestHandler } from "express";

/** Browsers mark service worker script fetches; only our engine may install a worker on this origin. */
export function serviceWorkerScriptGuard(): RequestHandler {
  return (req, res, next) => {
    if (req.get("service-worker") === "script" && req.path !== "/_g/sw.js") {
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }
    next();
  };
}
