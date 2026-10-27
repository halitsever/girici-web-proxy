import { encodeUrl } from "@girici/engine/shared";
import { Router } from "express";

/** v1 shared links looked like /proxy/<url>; they keep working by moving to the new scheme. */
export function legacyRouter(): Router {
  const router = Router();
  router.use("/proxy", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    let url: URL | undefined;
    try {
      url = new URL(req.originalUrl.slice("/proxy/".length));
    } catch {
      url = undefined;
    }
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.redirect(301, encodeUrl(url));
  });
  return router;
}
