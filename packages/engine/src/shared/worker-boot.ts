import { SHARED_WORKER_PATH, WORKER_NONCE_PARAM } from "./protocol.ts";

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
export const quote = JSON.stringify;
const encode = encodeURIComponent;

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

/** The longest shared address a page announces; a longer one starts its worker from a blob of its own. */
export const SHARED_PATH_LIMIT = 4096;

/** Built the same in every tab, so tabs of one site name one address and the browser joins them to one worker. */
export function sharedWorkerPath(scriptUrl: string, partition: string, module: boolean): string {
  return `${SHARED_WORKER_PATH}?s=${encode(scriptUrl)}&p=${encode(partition)}&t=${module ? "module" : "classic"}`;
}
