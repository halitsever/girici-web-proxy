import type { Route } from "../sites.ts";

/**
 * Fixture pages for subdomain mode, by host and path, served after the ones in `sites.ts`. This module and the
 * pages it imports must not use values from `sites.ts` at load time: that module imports this one.
 */
export const SUBDOMAIN_ROUTES: Record<string, Record<string, Route>> = {
  "site-a.test": {
    "/sites/harness": (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="en"><title>Harness</title><h1>Subdomain harness</h1></html>');
    },
  },
};
