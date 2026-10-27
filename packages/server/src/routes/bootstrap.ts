import { Router, type Request } from "express";

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
const DOCUMENT_DESTINATIONS = new Set(["document", "iframe", "frame"]);

/** Proxy URLs only reach the server when no service worker controls the tab, so this page installs one. */
export function bootstrapRouter(): Router {
  const router = Router();
  router.use("/~", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if ((req.method === "GET" || req.method === "HEAD") && isDocumentRequest(req)) {
      res.setHeader("Content-Security-Policy", BOOT_CSP);
      res.type("html").send(BOOT_PAGE);
      return;
    }
    res.status(404).type("text/plain").send("Girici is not active in this tab. Reload the page.");
  });
  return router;
}

function isDocumentRequest(req: Request): boolean {
  const destination = req.get("sec-fetch-dest");
  if (destination) return DOCUMENT_DESTINATIONS.has(destination);
  return (req.get("accept") ?? "").includes("text/html");
}
