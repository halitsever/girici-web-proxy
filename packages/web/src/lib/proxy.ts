import { syncEnginePrefs } from "./engine-prefs";
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
  await syncEnginePrefs(loadSettings());
}

export async function openProxied(path: string): Promise<void> {
  await startEngine();
  window.location.assign(path);
}

const RELOAD_KEY = "girici:engine-reload";
// One reload is enough when the engine works; a tab it still cannot take is left as it is.
const RELOAD_GAP_MS = 10_000;

export interface ReloadEnv {
  container: ServiceWorkerContainer | undefined;
  storage: () => Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: number;
}

/**
 * The engine takes settings and site data only from UI tabs whose load it saw. A hard reload goes around it, so such a
 * tab loads once more. True when the reload has started.
 */
export async function reloadThroughEngine(env: ReloadEnv = browserEnv()): Promise<boolean> {
  const { container } = env;
  if (!container || container.controller) return false;
  try {
    const registration = await container.getRegistration("/");
    if (!registration?.active) return false;
    const storage = env.storage();
    if (env.now - Number(storage.getItem(RELOAD_KEY)) < RELOAD_GAP_MS) return false;
    storage.setItem(RELOAD_KEY, String(env.now));
  } catch {
    // Without storage nothing would stop a reload loop, and the UI must still load.
    return false;
  }
  env.reload();
  return true;
}

function browserEnv(): ReloadEnv {
  return {
    container: navigator.serviceWorker,
    storage: () => sessionStorage,
    reload: () => location.reload(),
    now: Date.now(),
  };
}
