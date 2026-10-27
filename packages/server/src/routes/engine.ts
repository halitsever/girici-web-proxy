import express, { Router } from "express";

const HASHED_BUNDLE = /\/(?:client|worker)\.[\w-]+\.js(\.map)?$/;

export function engineRouter(dir: string): Router {
  const router = Router();
  router.use(
    "/_g",
    express.static(dir, {
      index: false,
      setHeaders: (res, path) => {
        // Hashed client bundles never change; the rest is revalidated so no stale engine keeps running.
        res.setHeader("Cache-Control", HASHED_BUNDLE.test(path) ? "public, max-age=31536000, immutable" : "no-cache");
        // The worker file lives under /_g/ but has to control the whole origin.
        if (path.endsWith("/sw.js")) res.setHeader("Service-Worker-Allowed", "/");
      },
    }),
  );
  return router;
}
