import { hookConstructor } from "./constructors.ts";

export interface WorkerBoot {
  runtimeUrl: string;
  scriptUrl: string;
  /** The worker's real URL, since its own location is a blob or proxy address. */
  base: string;
  partition: string;
  module: boolean;
}

/** Where a worker script loads from and the real URL it runs under. */
export interface WorkerSource {
  scriptUrl: string;
  base: string;
}

/** The globals a realm starts workers with; typed narrowly so worker scopes fit without the DOM lib. */
export interface WorkerGlobals {
  Worker?: new (url: string, options?: unknown) => object;
  SharedWorker?: new (url: string, options?: unknown) => object;
  URL?: { createObjectURL(blob: unknown): string };
  Blob?: new (parts: string[], options?: { type?: string }) => unknown;
}

export interface WorkerStart {
  /** Missing when the runtime itself was loaded without one; such a realm cannot start workers. */
  runtimeUrl: string | undefined;
  partition: () => string;
  /** The real URL a blob worker runs under, since it has none of its own. */
  blobBase: () => string;
  /** Proxy URL and real base for any script that is not a blob. */
  resolve: (raw: string) => WorkerSource;
}

// Taken at load, before page code can replace them and steer the bootstrap or receive a native.
const quote = JSON.stringify;
const apply = Reflect.apply;
const toText = String;
const NativeURL = URL;
const protocolOf = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")?.get as (this: URL) => string;

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

/** Starts every Worker and SharedWorker from a bootstrap blob, so the runtime is in place before the real script. */
export function hookWorkers(globals: WorkerGlobals, start: WorkerStart): void {
  // Taken now, so code that replaces them cannot hand the native constructor a script of its own.
  const urls = globals.URL;
  const createObjectURL = urls?.createObjectURL;
  const Blob = globals.Blob;
  const bootstrapUrl = (raw: string, options: unknown): string => {
    if (!start.runtimeUrl || !createObjectURL || !Blob) {
      throw new TypeError("Girici: no worker runtime to start this worker");
    }
    const source = isBlob(raw) ? { scriptUrl: raw, base: start.blobBase() } : start.resolve(raw);
    const code = workerBootstrapCode({
      runtimeUrl: start.runtimeUrl,
      ...source,
      partition: start.partition(),
      module: (options as { type?: unknown } | null | undefined)?.type === "module",
    });
    return apply(createObjectURL, urls, [new Blob([code], { type: "text/javascript" })]) as string;
  };
  for (const name of ["Worker", "SharedWorker"] as const) {
    const Native = globals[name];
    if (!Native) continue;
    globals[name] = hookConstructor(Native, (input) => [bootstrapUrl(toText(input[0]), input[1]), ...input.slice(1)]);
  }
}

/** Parsed rather than matched, so "BLOB:" or " blob:" are blobs too; a relative URL never is. */
function isBlob(raw: string): boolean {
  try {
    return apply(protocolOf, new NativeURL(raw), []) === "blob:";
  } catch {
    return false;
  }
}
