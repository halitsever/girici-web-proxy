import { Router } from "express";

/** AGPL section 13: users of the running service must be able to reach its source. */
export function sourceRouter(sourceUrl: string): Router {
  const router = Router();
  router.get("/_g/source", (_req, res) => {
    res.redirect(302, sourceUrl);
  });
  return router;
}
