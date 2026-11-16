import {
  captureSiteDataEnv,
  clearPartitions,
  partitionOrigins,
  PROTOCOL_VERSION,
  SITE_DATA_RPC_PATH,
  SITES_LIST_PATH,
  SITES_PLAN_PATH,
  type SiteDataEnv,
  type SiteListAnswer,
  type SitePlanAnswer,
  type SitePlanRequest,
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

/** The engine's own stores from single-origin mode; site hosts never open them. */
export const LEGACY_DATABASES = ["__girici", "__girici_keys", "__girici_prefs", "__girici_clients"];
const LEGACY_CACHE_PREFIX = "girici:";

/** Subdomain mode: the root lists the sites this browser opened from a cookie their hosts set. */
export async function listVisitedSites(fetcher: typeof fetch = fetch): Promise<SiteListAnswer["sites"]> {
  const res = await fetcher(SITES_LIST_PATH, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Could not load the sites you visited.");
  return ((await res.json()) as SiteListAnswer).sites;
}

/** What single-origin mode kept on the root; in subdomain mode no site can reach it. */
export async function hasLegacyRootData(env: SiteDataEnv): Promise<boolean> {
  if ((await partitionOrigins(env)).length > 0) return true;
  if ((await listOrEmpty(env.databaseNames)).some(isLegacyDatabase)) return true;
  return (await listOrEmpty(env.cacheNames)).some(isLegacyCache);
}

/** Partition names are the only storage keys removed, so the UI's own settings and history stay. */
export async function clearLegacyRootData(env: SiteDataEnv): Promise<void> {
  await clearPartitions(env, null);
  for (const name of await listOrEmpty(env.databaseNames)) if (isLegacyDatabase(name)) await env.deleteDatabase(name);
  for (const name of await listOrEmpty(env.cacheNames)) if (isLegacyCache(name)) await env.deleteCache(name);
}

export interface ClearSitesEnv {
  siteData: SiteDataEnv;
  fetcher: typeof fetch;
  assign(url: string): void;
}

/** Each site host clears only its own data, so the page leaves for a chain of hops through them back to Settings. */
export async function clearSites(sites: string[] | "all", env: ClearSitesEnv = browserClearEnv()): Promise<void> {
  await clearLegacyRootData(env.siteData);
  const body: SitePlanRequest = { sites };
  // Called as a method, the browser's fetch would take `env` as its window and throw.
  const { fetcher } = env;
  const res = await fetcher(SITES_PLAN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const start = res.ok ? ((await res.json()) as Partial<SitePlanAnswer>).start : undefined;
  if (typeof start !== "string") throw new Error("Could not start clearing site data.");
  env.assign(start);
}

function browserClearEnv(): ClearSitesEnv {
  return {
    siteData: captureSiteDataEnv(window),
    fetcher: fetch,
    assign: (url) => window.location.assign(url),
  };
}

/** The Settings note after the chain comes back with `?cleared=<n>`; empty for anything else. */
export function clearedNote(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return "";
  const count = Number(value);
  return count === 1 ? "Cleared 1 site." : `Cleared ${count} sites.`;
}

/** Most sites are https, so only a plain http site keeps its scheme in the list. */
export function siteName(site: string): string {
  return site.startsWith("https://") ? site.slice("https://".length) : site;
}

const isLegacyDatabase = (name: string): boolean => LEGACY_DATABASES.includes(name);
const isLegacyCache = (name: string): boolean => name.startsWith(LEGACY_CACHE_PREFIX);

/** A private window can refuse to list its stores; there is then nothing to find or clear. */
async function listOrEmpty(list: () => Promise<string[]>): Promise<string[]> {
  try {
    return await list();
  } catch {
    return [];
  }
}
