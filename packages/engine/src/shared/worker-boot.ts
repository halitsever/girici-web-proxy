import { WORKER_NONCE_PARAM } from "./protocol.ts";

export interface WorkerBoot {
  runtimeUrl: string;
  /** Announced to the service worker by the starting realm; the runtime import names it to claim that binding. */
  nonce: string;
  scriptUrl: string;
  /** The worker's real URL, since its own location is a blob or proxy address. */
  base: string;
  partition: string;
  module: boolean;
}

/** Taken at load, so a page that replaces it cannot steer what a worker runs first. */
const quote = JSON.stringify;

/** A worker's first script: it hands the runtime its boot values, then loads the runtime before the real script. */
export function workerBootstrapCode(boot: WorkerBoot): string {
  const runtime = quote(`${boot.runtimeUrl}?${WORKER_NONCE_PARAM}=${boot.nonce}`);
  const script = quote(boot.scriptUrl);
  // Nested workers announce their own nonce, so the global keeps the plain runtime URL.
  const globals =
    `self.__giriciBase=${quote(boot.base)};self.__giriciRuntime=${quote(boot.runtimeUrl)};` +
    `self.__giriciPartition=${quote(boot.partition)};`;
  return boot.module
    ? `${globals}await import(${runtime});await import(${script});`
    : `${globals}importScripts(${runtime},${script});`;
}
