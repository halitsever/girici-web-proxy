import { joined } from "../shared/primordials.ts";
import { PROTOCOL_VERSION, WORKER_RPC_PATH } from "../shared/protocol.ts";
import { workerBootstrapCode } from "../shared/worker-boot.ts";
import { hookConstructor } from "./constructors.ts";

export { workerBootstrapCode, type WorkerBoot } from "../shared/worker-boot.ts";

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
  /** The proxy origin, where the service worker hears announcements. */
  origin: string;
  /** The realm's fetch, taken before any hook rewrites its URLs. */
  fetch: ((input: string, init: object) => unknown) | undefined;
  partition: () => string;
  /** The real URL a blob worker runs under, since it has none of its own. */
  blobBase: () => string;
  /** Proxy URL and real base for any script that is not a blob. */
  resolve: (raw: string) => WorkerSource;
}

// Taken at load, before page code can replace them and steer the bootstrap or receive a native.
const apply = Reflect.apply;
const toText = String;
const NativeURL = URL;
const protocolOf = Object.getOwnPropertyDescriptor(URL.prototype, "protocol")?.get as (this: URL) => string;
const nativeCrypto = globalThis.crypto;
const getRandomValues = nativeCrypto.getRandomValues;
const Bytes = Uint8Array;
const HEX = "0123456789abcdef";
const then = Promise.prototype.then;
const defineProperty = Object.defineProperty;
const iteratorKey = Symbol.iterator;

/** Starts every Worker and SharedWorker from a bootstrap blob, so the runtime is in place before the real script. */
export function hookWorkers(globals: WorkerGlobals, start: WorkerStart): void {
  // Taken now, so code that replaces them cannot hand the native constructor a script of its own.
  const urls = globals.URL;
  const createObjectURL = urls?.createObjectURL;
  const Blob = globals.Blob;
  const bootstrapUrl = (raw: string, options: unknown): string => {
    if (!start.runtimeUrl || !start.fetch || !createObjectURL || !Blob) {
      throw new TypeError("Girici: no worker runtime to start this worker");
    }
    const source = isBlob(raw) ? { scriptUrl: raw, base: start.blobBase() } : start.resolve(raw);
    const nonce = randomHex();
    // Sent before the worker exists, so the service worker learns who started it before its first request.
    const body = '{"v":' + PROTOCOL_VERSION + ',"n":"' + nonce + '"}';
    const announced = apply(start.fetch, globals, [
      start.origin + WORKER_RPC_PATH,
      { __proto__: null, method: "POST", body },
    ]);
    // A failed announcement leaves the worker unbound, which the service worker treats as third-party.
    try {
      apply(then, announced, [undefined, () => {}]);
    } catch {
      // Not a promise, so there is no rejection to swallow.
    }
    const code = workerBootstrapCode({
      runtimeUrl: start.runtimeUrl,
      nonce,
      ...source,
      partition: start.partition(),
      module: (options as { type?: unknown } | null | undefined)?.type === "module",
    });
    const blobOptions = { __proto__: null, type: "text/javascript" } as { type: string };
    return apply(createObjectURL, urls, [new Blob(blobParts(code), blobOptions)]) as string;
  };
  // Indexed, without spreads: adopting a frame installs this inside a page call.
  const names = ["Worker", "SharedWorker"] as const;
  for (let index = 0; index < names.length; index++) {
    const name = names[index] as (typeof names)[number];
    const Native = globals[name];
    if (!Native) continue;
    globals[name] = hookConstructor(Native, (input) => joined([bootstrapUrl(toText(input[0]), input[1])], input, 1));
  }
}

/** 16 random bytes as hex, built only from typed array and string indexing, which no page code can reach. */
function randomHex(): string {
  const bytes = new Bytes(16);
  apply(getRandomValues, nativeCrypto, [bytes]);
  let hex = "";
  for (let index = 0; index < 16; index++) {
    const byte = bytes[index] ?? 0;
    hex += HEX[byte >> 4]! + HEX[byte & 15]!;
  }
  return hex;
}

/**
 * One Blob part whose iteration reads only own properties, so a page that replaced the array iterator or its next
 * cannot hand the Blob a script of its own.
 */
export function blobParts(part: string): string[] {
  const parts = [part];
  let given = false;
  const next = () => {
    if (given) return { __proto__: null, done: true, value: undefined };
    given = true;
    return { __proto__: null, done: false, value: part };
  };
  defineProperty(parts, iteratorKey, {
    __proto__: null,
    value: () => ({ __proto__: null, next }),
  } as PropertyDescriptor);
  return parts;
}

/** Parsed rather than matched, so "BLOB:" or " blob:" are blobs too; a relative URL never is. */
function isBlob(raw: string): boolean {
  try {
    return apply(protocolOf, new NativeURL(raw), []) === "blob:";
  } catch {
    return false;
  }
}
