import { labelSiteOf } from "@girici/engine/label-site";
import { decodeUrl, escapeAttribute, siteLabel, type SiteDomain } from "@girici/engine/shared";
import express, { Router, type Request, type Response } from "express";
import { requestHost, siteHostFor } from "../sites/hosts.ts";
import type { SiteSetup } from "../sites/keys.ts";

const BOOT_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Girici</title>
    <script src="/_g/boot.js" defer></script>
  </head>
  <body>
    <p id="girici-boot">Starting Girici...</p>
    <noscript>Girici needs JavaScript.</noscript>
  </body>
</html>
`;
const BOOT_CSP = "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const INERT_CSP = "sandbox; default-src 'none'";
const NOT_ACTIVE = "Girici is not active in this tab. Reload the page.";

export const FRESH_POST =
  "Girici has not opened this site in this browser yet. Open the site once, then send the form again.";

const URLENCODED = "application/x-www-form-urlencoded";
const PLAIN_TEXT = "text/plain";
const REPLAY_LIMIT = "1mb";
const FRAME_DESTINATIONS = new Set(["document", "iframe", "frame"]);

/** Other site hosts of this instance may frame a site; a port must be written out or only the default one matches. */
export function bootCsp(domain: SiteDomain, formAction: "'none'" | "'self'" = "'none'"): string {
  return (
    `default-src 'none'; script-src 'self'; base-uri 'none'; form-action ${formAction}; ` +
    `frame-ancestors 'self' *.${domain.value}`
  );
}

/** The boot page plus the posted fields, which boot.js submits again once the worker controls the tab. */
export function replayPage(fields: Array<[string, string]>, enctype: string): string {
  const inputs = fields
    .map(
      ([name, value]) =>
        `\n      <input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`,
    )
    .join("");
  // No action: the form posts back to the address it came from.
  const form = `<form id="girici-replay" method="post" enctype="${enctype}" hidden>${inputs}\n    </form>`;
  return BOOT_PAGE.replace("  </body>", `    ${form}\n  </body>`);
}

/** Proxy URLs only reach the server when no service worker controls the tab, so this page installs one. */
export function bootstrapRouter(setup?: SiteSetup): Router {
  const router = Router();
  const replayBody = express.raw({ type: () => true, limit: REPLAY_LIMIT });
  router.use("/~", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (setup && moveToSiteHost(req, res, setup)) return;
    if ((req.method === "GET" || req.method === "HEAD") && isDocumentRequest(req, setup)) {
      res.setHeader("Content-Security-Policy", setup ? bootCsp(setup.domain) : BOOT_CSP);
      // A popup that lands here before its service worker runs keeps its opener.
      res.removeHeader("Cross-Origin-Opener-Policy");
      res.type("html").send(BOOT_PAGE);
      return;
    }
    if (setup && req.method === "POST" && isDocumentRequest(req, setup)) {
      const enctype = mediaType(req);
      if (enctype === URLENCODED || enctype === PLAIN_TEXT) {
        replayBody(req, res, (error?: unknown) => {
          if (error) {
            next(error);
            return;
          }
          res.setHeader("Content-Security-Policy", bootCsp(setup.domain, "'self'"));
          res.removeHeader("Cross-Origin-Opener-Policy");
          res.type("html").send(replayPage(formFields(req.body, enctype), enctype));
        });
        return;
      }
      // A multipart body may hold files, which a page cannot put back into a form.
      sendInert(res, FRESH_POST);
      return;
    }
    // Anything else comes from a page the service worker already controls, where the bootstrap would only reload.
    // Sandboxed, a frame or object that lands here leaves no same-origin window to script.
    sendInert(res, NOT_ACTIVE);
  });
  return router;
}

/** A plain address of another site goes to that site's host; a POST keeps its body through a 307. */
function moveToSiteHost(req: Request, res: Response, setup: SiteSetup): boolean {
  const host = requestHost(res);
  const target = decodeUrl(req.originalUrl);
  if (host.kind !== "site" || !target) return false;
  if (siteLabel(setup.keys.label, labelSiteOf(target)) === host.label) return false;
  const status = req.method === "GET" || req.method === "HEAD" ? 302 : 307;
  res.redirect(status, `//${siteHostFor(target, setup)}${req.originalUrl}`);
  return true;
}

function sendInert(res: Response, text: string): void {
  res.setHeader("Content-Security-Policy", INERT_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(404).type("text/plain").send(text);
}

/**
 * Only a top-level load gets the bootstrap page in single-origin mode. On a site host frames get it too, since a site
 * embedded for the first time has to install its worker inside the frame.
 */
function isDocumentRequest(req: Request, setup: SiteSetup | undefined): boolean {
  const destination = req.get("sec-fetch-dest");
  if (destination) return setup ? FRAME_DESTINATIONS.has(destination) : destination === "document";
  return (req.get("accept") ?? "").includes("text/html");
}

function mediaType(req: Request): string {
  return (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Keeps order and repeated names, which a server reading the form may depend on. */
function formFields(body: unknown, enctype: string): Array<[string, string]> {
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : "";
  if (enctype === URLENCODED) return [...new URLSearchParams(text)];
  const fields: Array<[string, string]> = [];
  for (const line of text.split("\r\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    fields.push(eq < 0 ? [line, ""] : [line.slice(0, eq), line.slice(eq + 1)]);
  }
  return fields;
}
