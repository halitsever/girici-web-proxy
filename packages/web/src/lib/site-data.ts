import {
  captureSiteDataEnv,
  clearPartitions,
  partitionOrigins,
  PROTOCOL_VERSION,
  SITE_DATA_RPC_PATH,
  type SiteSummary,
} from "@girici/engine/shared";

const NEEDS_WORKER = "Site data needs the Girici service worker. Reload and try again.";

/** The cookie jar lives in the service worker, which only answers pages it controls. */
async function ensureController(): Promise<void> {
  const container = navigator.serviceWorker;
  if (!container) throw new Error(NEEDS_WORKER);
  await container.register("/_g/sw.js", { scope: "/", updateViaCache: "none" });
  await container.ready;
  if (container.controller) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(NEEDS_WORKER)), 3000);
    container.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function siteDataRpc<T>(body: Record<string, unknown>): Promise<T> {
  await ensureController();
  const res = await fetch(SITE_DATA_RPC_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: PROTOCOL_VERSION, ...body }),
  });
  if (!res.ok) throw new Error("Could not reach the site data store.");
  return res.json() as Promise<T>;
}

export async function listSiteData(): Promise<SiteSummary[]> {
  const origins = await partitionOrigins(captureSiteDataEnv(window));
  return (await siteDataRpc<{ sites: SiteSummary[] }>({ op: "list", origins })).sites;
}

/** Clears one site's cookies and storage, or every site's when site is null. */
export async function clearSiteData(site: string | null): Promise<void> {
  await siteDataRpc(site === null ? { op: "clear-all" } : { op: "clear", site });
  await clearPartitions(captureSiteDataEnv(window), site);
}
