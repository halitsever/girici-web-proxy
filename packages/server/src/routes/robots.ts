import { Router } from "express";

export function robotsRouter(): Router {
  const router = Router();
  router.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });
  return router;
}
