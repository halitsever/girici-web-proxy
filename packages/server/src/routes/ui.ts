import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { Router } from "express";
import { UI_CSP } from "../http/security-headers.ts";

export function uiRouter(webDistDir: string): Router {
  const router = Router();
  router.use("/_g/ui", express.static(join(webDistDir, "_g/ui"), { immutable: true, maxAge: "1y", index: false }));
  router.get("/", (_req, res) => {
    // Checked per request so a UI built after startup is served without a restart.
    if (!existsSync(join(webDistDir, "index.html"))) {
      res.status(503).type("text/plain").send("Web UI is not built. Run npm run build.");
      return;
    }
    res.set({
      "Content-Security-Policy": UI_CSP,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cache-Control": "no-cache",
    });
    res.sendFile("index.html", { root: webDistDir, cacheControl: false });
  });
  return router;
}
