/**
 * Fixture pages for the compatibility tracks, one file per track so parallel branches never edit one table.
 * sites.ts imports this module, so track files may use only its function helpers (page, html, script) at load.
 */
import type { Route } from "../sites.ts";
import { socketLog } from "../sockets.ts";
import { ROUTES as COOKIES } from "./cookies.ts";
import { ROUTES as SCRIPTS } from "./scripts.ts";
import { ROUTES as SHARED_WORKER } from "./shared-worker.ts";
import { ROUTES as WEBSOCKET } from "./websocket.ts";

export type CompatRoutes = Record<string, Record<string, Route>>;

const socketLogRoute: Route = (req, res) => {
  const id = new URL(req.url ?? "/", "http://fixture").searchParams.get("id") ?? "";
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(socketLog(id)));
};

/** Throws on a host and path two tables both serve, so a merged track can never silently replace another's page. */
export function mergeRoutes(...tables: CompatRoutes[]): CompatRoutes {
  const merged: CompatRoutes = {};
  for (const table of tables) {
    for (const [host, paths] of Object.entries(table)) {
      const into = (merged[host] ??= {});
      for (const [path, route] of Object.entries(paths)) {
        if (into[path]) throw new Error(`Two compat fixtures serve ${host}${path}`);
        into[path] = route;
      }
    }
  }
  return merged;
}

export const COMPAT_ROUTES = mergeRoutes(
  { "site-a.test": { "/socket-log": socketLogRoute } },
  WEBSOCKET,
  SHARED_WORKER,
  SCRIPTS,
  COOKIES,
);
