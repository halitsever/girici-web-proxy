import { PREFS_MESSAGE, PROTOCOL_VERSION } from "@girici/engine/shared";
import type { Settings } from "./settings";

const ANSWER_MS = 1000;

/** The service worker cannot read localStorage, so the UI tells it the switches it needs. */
export async function syncEnginePrefs(
  settings: Pick<Settings, "blockCookies" | "sealAddresses">,
  container: ServiceWorkerContainer | undefined = navigator.serviceWorker,
  instanceSeal?: boolean,
): Promise<void> {
  if (!container) return;
  const registration = await container.getRegistration("/");
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  if (!worker) return;
  const message: Record<string, unknown> = {
    type: PREFS_MESSAGE,
    v: PROTOCOL_VERSION,
    blockThirdPartyCookies: settings.blockCookies,
    sealAddresses: settings.sealAddresses,
  };
  if (instanceSeal !== undefined) message.instanceSeal = instanceSeal;
  const channel = new MessageChannel();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ANSWER_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    worker.postMessage(message, [channel.port2]);
  });
  channel.port1.close();
}
