import { decodeUrl, encodeUrl, isSealedPath, LOGIN_PATH } from "@girici/engine/shared";
import { Router, type Response } from "express";
import { isAdminCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { siteHostFor } from "../sites/hosts.ts";
import type { SiteSetup } from "../sites/keys.ts";

export const SEALED_GONE =
  "Addresses encrypted before this server moved sites to their own addresses do not open any more. " +
  "Open the site again from Girici.";

/** Takes over a root worker left from single-origin mode and removes it, so the root never proxies. */
export const RETIRE_WORKER =
  'self.addEventListener("install",()=>self.skipWaiting());' +
  'self.addEventListener("activate",(e)=>e.waitUntil(self.registration.unregister()));';

const INERT_CSP = "sandbox; default-src 'none'";

/** The root serves the UI only; proxy addresses typed or bookmarked there move to their site's host. */
export function siteRootRouter(setup: SiteSetup, store: AuthStore): Router {
  const router = Router({ caseSensitive: true, strict: true });

  router.use("/~", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    // Each site host seals with its own key, so nothing here can open these.
    if (isSealedPath(req.originalUrl)) {
      sendInert(res, 404, SEALED_GONE);
      return;
    }
    const target = decodeUrl(req.originalUrl);
    if (!target) {
      sendInert(res, 400, "Bad Request");
      return;
    }
    // Signed-out visitors of a private instance learn no site hosts from here.
    if (!store.publicAccess() && !isAdminCookie(store, req.headers.cookie)) {
      res.redirect(302, `${LOGIN_PATH}?next=${encodeURIComponent(target.href)}`);
      return;
    }
    // Scheme-relative, so the site host opens on the scheme the page used.
    res.redirect(302, `//${siteHostFor(target, setup)}${encodeUrl(target)}`);
  });

  router.get("/_g/sw.js", (_req, res) => {
    res.set({
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      // The old registration's scope is "/", and an update that may not keep it fails and leaves the worker running.
      "Service-Worker-Allowed": "/",
    });
    res.send(RETIRE_WORKER);
  });

  return router;
}

/** Site hosts serve the engine and their own site; everything for people lives on the root. */
export function siteHostRouter(setup: SiteSetup): Router {
  const router = Router({ caseSensitive: true, strict: true });
  router.get("/", (_req, res) => {
    res.redirect(302, `//${setup.domain.value}/`);
  });
  return router;
}

function sendInert(res: Response, status: number, text: string): void {
  res.setHeader("Content-Security-Policy", INERT_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(status).type("text/plain").send(text);
}
