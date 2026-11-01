import { parseSiteDomain, PREFS_PATH, SITE_LABEL_LENGTH, type SitePrefs } from "@girici/engine/shared";
import type { AuthState } from "./auth";
import { syncEnginePrefs } from "./engine-prefs";
import type { Settings } from "./settings";

const RETIRE_KEY = "girici:retire-reload";
const SEEN_KEY = "girici:seen";
const NEVER = /(?!)/;

/** Where the root remembers that this browser opened a site from Girici. */
export type SeenStorage = () => Pick<Storage, "getItem" | "setItem">;

/** Subdomain mode: the server names a site domain and every proxied site opens on its own host under it. */
export function isSiteMode(state: Pick<AuthState, "siteDomain"> | null): boolean {
  return typeof state?.siteDomain === "string" && parseSiteDomain(state.siteDomain) !== null;
}

/** Site hosts cannot read the UI's localStorage, so the root keeps these settings in a cookie for them. */
export async function syncSitePrefs(
  settings: Settings,
  fetcher: typeof fetch = fetch,
  storage: SeenStorage = () => localStorage,
): Promise<void> {
  await postSitePrefs(settings, fetcher, () => hasSeen(storage));
}

/** Only a visitor who opens a site from Girici's own pages has seen what it is; every site host learns it here. */
export async function markSitesSeen(
  settings: Settings,
  fetcher: typeof fetch = fetch,
  storage: SeenStorage = () => localStorage,
): Promise<void> {
  try {
    storage().setItem(SEEN_KEY, "1");
  } catch {
    // The cookie still says so until the next settings change.
  }
  await postSitePrefs(settings, fetcher, () => true);
}

function hasSeen(storage: SeenStorage): boolean {
  try {
    return storage().getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** One post at a time, so the cookie an older one sets never lands after a newer one's. */
let posting: Promise<void> = Promise.resolve();

function postSitePrefs(settings: Settings, fetcher: typeof fetch, seen: () => boolean): Promise<void> {
  const next = posting.then(() => sendSitePrefs(settings, fetcher, seen()));
  posting = next;
  return next;
}

async function sendSitePrefs(settings: Settings, fetcher: typeof fetch, seen: boolean): Promise<void> {
  const prefs: SitePrefs = {
    blockThirdPartyCookies: settings.blockCookies,
    sealAddresses: settings.sealAddresses,
    toolbar: settings.toolbar,
    engine: settings.engine,
    seen,
  };
  try {
    await fetcher(PREFS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
    });
  } catch {
    // Sites keep the last settings that arrived; the next change or UI load posts again.
  }
}

export async function syncSettings(settings: Settings, state: AuthState | null): Promise<void> {
  if (isSiteMode(state)) await syncSitePrefs(settings);
  else await syncEnginePrefs(settings);
}

export interface RetireEnv {
  container(): ServiceWorkerContainer | undefined;
  storage(): Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload(): void;
}

/**
 * A worker left on the root from single-origin mode would keep proxying there, so it goes, and a tab it controls loads
 * once more without it. A mark still there on a controlled load means that reload did not help.
 */
export async function retireRootEngine(env: RetireEnv = browserRetireEnv()): Promise<boolean> {
  try {
    const container = env.container();
    if (!container) return false;
    const registration = await container.getRegistration("/");
    await registration?.unregister();
    const storage = env.storage();
    if (!container.controller) {
      storage.removeItem(RETIRE_KEY);
      return false;
    }
    if (storage.getItem(RETIRE_KEY) !== null) return false;
    storage.setItem(RETIRE_KEY, "1");
  } catch {
    // The UI must still load, and without storage nothing would stop a reload loop.
    return false;
  }
  env.reload();
  return true;
}

function browserRetireEnv(): RetireEnv {
  return {
    container: () => navigator.serviceWorker,
    storage: () => sessionStorage,
    reload: () => location.reload(),
  };
}

/** A proxy address on one of this instance's site hosts, as the sign-in `next` of a site host carries it. */
export function siteUrlPattern(siteDomain: string): RegExp {
  const domain = parseSiteDomain(siteDomain);
  if (!domain) return NEVER;
  const escaped = domain.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https?://[a-z2-7]{${SITE_LABEL_LENGTH}}\\.${escaped}/~/`);
}
