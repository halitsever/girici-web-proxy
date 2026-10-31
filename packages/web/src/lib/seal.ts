import { PROTOCOL_VERSION, SEAL_MESSAGE } from "@girici/engine/shared";

const ANSWER_MS = 1000;

/** The worker holds the address key, so it seals the path; any failure opens the plain address instead. */
export async function sealPath(
  path: string,
  container: ServiceWorkerContainer | undefined = navigator.serviceWorker,
): Promise<string> {
  if (!container) return path;
  const registration = await container.getRegistration("/");
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  if (!worker) return path;
  const channel = new MessageChannel();
  const sealed = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(path), ANSWER_MS);
    channel.port1.onmessage = (event: MessageEvent<{ path?: unknown } | null>) => {
      clearTimeout(timer);
      const answer = event.data?.path;
      resolve(typeof answer === "string" && answer.startsWith("/~/") ? answer : path);
    };
    worker.postMessage({ type: SEAL_MESSAGE, v: PROTOCOL_VERSION, path }, [channel.port2]);
  });
  channel.port1.close();
  return sealed;
}
