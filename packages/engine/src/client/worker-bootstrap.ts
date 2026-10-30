export interface WorkerBoot {
  runtimeUrl: string;
  scriptUrl: string;
  /** The worker's real URL, since its own location is a blob or proxy address. */
  base: string;
  partition: string;
  module: boolean;
}

// Taken at load, before page code can replace it and smuggle code into the bootstrap.
const quote = JSON.stringify;

/** A worker's first script: it hands the runtime its boot values, then loads the runtime before the real script. */
export function workerBootstrapCode(boot: WorkerBoot): string {
  const runtime = quote(boot.runtimeUrl);
  const script = quote(boot.scriptUrl);
  const globals =
    `self.__giriciBase=${quote(boot.base)};self.__giriciRuntime=${runtime};` +
    `self.__giriciPartition=${quote(boot.partition)};`;
  return boot.module
    ? `${globals}await import(${runtime});await import(${script});`
    : `${globals}importScripts(${runtime},${script});`;
}
