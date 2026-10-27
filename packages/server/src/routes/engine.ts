import express, { Router } from "express";

export function engineRouter(dir: string): Router {
  const router = Router();
  router.use(
    "/_g",
    express.static(dir, {
      index: false,
      setHeaders: (res, path) => {
        // A stale engine would keep running old interception code, so browsers must revalidate.
        res.setHeader("Cache-Control", "no-cache");
        // The worker file lives under /_g/ but has to control the whole origin.
        if (path.endsWith("/sw.js")) res.setHeader("Service-Worker-Allowed", "/");
      },
    }),
  );
  return router;
}
