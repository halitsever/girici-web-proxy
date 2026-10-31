import { getAuthState } from "./auth";
import { syncEnginePrefs } from "./engine-prefs";
import { sealPath } from "./seal";
import { loadSettings } from "./settings";

export type ServiceWorkerSupport = "ok" | "insecure" | "unsupported";

/** Browsers hide navigator.serviceWorker outside secure contexts, which is the usual reason it is missing. */
export function serviceWorkerSupport(env: {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
}): ServiceWorkerSupport {
  if (env.hasServiceWorker) return "ok";
  return env.isSecureContext ? "unsupported" : "insecure";
}

/** The worker must be active, and know the current switches, before the first proxied page loads. */
export async function startEngine(): Promise<void> {
  await navigator.serviceWorker.register("/_g/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  // A worker that just installed may not have read the admin's switch yet.
  const state = await getAuthState().catch(() => null);
  await syncEnginePrefs(loadSettings(), undefined, state?.sealAddresses);
}

export interface OpenEnv {
  start(): Promise<void>;
  seal(path: string): Promise<string>;
  assign(url: string): void;
}

/** The worker answers with the sealed address while sealing is on, so the plain one never reaches history. */
export async function openProxied(path: string, env: OpenEnv = browserOpenEnv()): Promise<void> {
  await env.start();
  env.assign(await env.seal(path));
}

function browserOpenEnv(): OpenEnv {
  return { start: startEngine, seal: (path) => sealPath(path), assign: (url) => window.location.assign(url) };
}

const RELOAD_KEY = "girici:engine-reload";

export interface ReloadEnv {
  container: () => ServiceWorkerContainer | undefined;
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
  /** False when the engine refuses this tab the UI's own API, as it does a tab whose load it did not see. */
  knowsTab: () => Promise<boolean>;
}

/**
 * The engine takes settings and site data only from UI tabs whose load it saw. A hard reload goes around it, and a tab
 * can also gain control later from an engine that never saw it load, so such a tab loads once more. A mark still there
 * on the next load means that reload did not help; a controlled load clears it.
 */
export async function reloadThroughEngine(env: ReloadEnv = browserEnv()): Promise<boolean> {
  try {
    const container = env.container();
    if (!container) return false;
    if (container.controller) {
      env.storage().removeItem(RELOAD_KEY);
      return false;
    }
    container.addEventListener("controllerchange", () => void reloadIfUnknown(env), { once: true });
    const registration = await container.getRegistration("/");
    if (!registration?.active || !markReload(env)) return false;
  } catch {
    // The UI must still load, and without storage nothing would stop a reload loop.
    return false;
  }
  env.reload();
  return true;
}

async function reloadIfUnknown(env: ReloadEnv): Promise<void> {
  try {
    if ((await env.knowsTab()) || !markReload(env)) return;
  } catch {
    return;
  }
  env.reload();
}

/** Sets the mark, or returns false when it is already there. */
function markReload(env: ReloadEnv): boolean {
  const storage = env.storage();
  if (storage.getItem(RELOAD_KEY) !== null) return false;
  storage.setItem(RELOAD_KEY, "1");
  return true;
}

function browserEnv(): ReloadEnv {
  return {
    container: () => navigator.serviceWorker,
    storage: () => sessionStorage,
    reload: () => location.reload(),
    knowsTab: async () => (await fetch("/_g/auth/state")).status !== 403,
  };
}
