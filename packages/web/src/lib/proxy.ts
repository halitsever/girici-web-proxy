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
