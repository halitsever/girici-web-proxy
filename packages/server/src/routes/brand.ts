import { Router } from "express";
import type { BrandStore } from "../brand/store.ts";

// The sandbox keeps an SVG opened on its own from running script or reaching the network.
export const LOGO_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** Public: sign-in and setup show the brand before anyone is signed in. */
export function brandRouter(brand: BrandStore): Router {
  const router = Router();
  router.get("/_g/brand", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json(brand.info());
  });
  router.get("/_g/brand/logo", (req, res) => {
    const logo = brand.logo();
    if (!logo) {
      res.status(404).end();
      return;
    }
    const etag = `"${logo.sha256}"`;
    res.set({
      "Content-Type": logo.type,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": LOGO_CSP,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-cache",
      ETag: etag,
    });
    if (
      req
        .get("if-none-match")
        ?.split(",")
        .some((tag) => tag.trim().replace(/^W\//, "") === etag)
    ) {
      res.status(304).end();
      return;
    }
    res.send(logo.bytes);
  });
  return router;
}
