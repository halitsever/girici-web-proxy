export type ServiceWorkerSupport = "ok" | "insecure" | "unsupported";

/** Browsers hide navigator.serviceWorker outside secure contexts, which is the usual reason it is missing. */
export function serviceWorkerSupport(env: {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
}): ServiceWorkerSupport {
  if (env.hasServiceWorker) return "ok";
  return env.isSecureContext ? "unsupported" : "insecure";
}

/** The worker must be active before navigating, or the first proxied page would bypass it. */
export async function openProxied(path: string): Promise<void> {
  await navigator.serviceWorker.register("/_g/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  window.location.assign(path);
}
