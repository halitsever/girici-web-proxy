import { existsSync } from "node:fs";
import { join } from "node:path";
import { LOGIN_PATH, SETUP_PATH } from "@girici/engine/shared";
import express, { Router, type Request, type Response } from "express";
import { sessionAdmin } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { PERMISSIONS_POLICY, UI_CSP } from "../http/security-headers.ts";

// The UI is a single-page app; these client routes all load the same shell.
const APP_ROUTES = ["/", "/settings", "/account", LOGIN_PATH, SETUP_PATH];

export function uiRouter(webDistDir: string, store: AuthStore): Router {
  const router = Router();
  router.use("/_g/ui", express.static(join(webDistDir, "_g/ui"), { immutable: true, maxAge: "1y", index: false }));
  const shell = (req: Request, res: Response) => {
    const redirect = shellRedirect(store, req.path, authed(store, req));
    if (redirect) {
      res.redirect(302, redirect);
      return;
    }
    // Checked per request so a UI built after startup is served without a restart.
    if (!existsSync(join(webDistDir, "index.html"))) {
      res.status(503).type("text/plain").send("Web UI is not built. Run npm run build.");
      return;
    }
    res.set({
      "Content-Security-Policy": UI_CSP,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Permissions-Policy": PERMISSIONS_POLICY,
      "Cache-Control": "no-cache",
    });
    res.sendFile("index.html", { root: webDistDir, cacheControl: false });
  };
  for (const route of APP_ROUTES) router.get(route, shell);
  return router;
}

function authed(store: AuthStore, req: Request): boolean {
  return sessionAdmin(store, req.headers.cookie) !== null;
}

/** Server-side funnel so an unauthed shell never flashes before the client guard runs. */
function shellRedirect(store: AuthStore, path: string, isAuthed: boolean): string | null {
  if (!store.hasAdmin()) return path === SETUP_PATH ? null : SETUP_PATH;
  if (path === SETUP_PATH) return isAuthed ? "/" : LOGIN_PATH;
  if (path === LOGIN_PATH) return isAuthed ? "/" : null;
  if (!isAuthed && !store.publicAccess()) return LOGIN_PATH;
  return null;
}
