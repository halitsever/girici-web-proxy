/**
 * A SharedWorker of a proxied script loads from one address per script, partition and type, so tabs of one site join
 * one instance. The worker answers that address with the bootstrap a fitting page announced, and nothing otherwise.
 */
import { decodeUrl } from "../shared/codec.ts";
import { partitionOrigin, partitionTop, sameSite } from "../shared/partition.ts";
import { SHARED_WORKER_PATH } from "../shared/protocol.ts";
import { sharedWorkerPath, workerBootstrapCode } from "../shared/worker-boot.ts";
import { inertHeaders } from "./error-page.ts";
import type { WorkerIdentity } from "./worker-identity.ts";

/** The script request can overtake the announcement its page sent first. */
export const SHARED_START_WAIT_MS = 1000;
/**
 * A page that joins a running instance announces too, but the browser fetches no script for it. Kept this short, its
 * leftover never outlives the nonce it names or lets another page start the instance long after.
 */
export const SHARED_START_TTL_MS = 5000;

export interface SharedStart {
  scriptUrl: string;
  /** The script's real URL. */
  base: URL;
  partition: string;
  module: boolean;
}

interface Announced {
  nonce: string;
  identity: WorkerIdentity;
  at: number;
}

/** The start an address names, or null for any address the page hook would not build. */
export function readSharedStart(url: URL, origin: string): SharedStart | null {
  if (url.origin !== origin || url.pathname !== SHARED_WORKER_PATH) return null;
  const scriptUrl = url.searchParams.get("s");
  const partition = url.searchParams.get("p");
  const type = url.searchParams.get("t");
  if (scriptUrl === null || partition === null || (type !== "classic" && type !== "module")) return null;
  const module = type === "module";
  // One spelling per start, so a reordered or padded query cannot name a second instance of it.
  const canonical = new URL(sharedWorkerPath(scriptUrl, partition, module), origin);
  if (canonical.search !== url.search) return null;
  const script = parse(scriptUrl);
  if (!script || script.origin !== origin) return null;
  const base = decodeUrl(script.pathname + script.search);
  if (!base || partitionOrigin(partition) === null) return null;
  return { scriptUrl, base, partition, module };
}

/** The partition must be the announcing page's own origin, under the top that page really has. */
export function startFits(start: SharedStart, identity: WorkerIdentity): boolean {
  const page = parse(identity.page);
  if (!page || partitionOrigin(start.partition) !== page.origin) return false;
  const top = partitionTop(start.partition);
  if (top === null) return identity.top === null || sameSite(page, identity.top);
  if (top === "null") return true;
  const topUrl = parse(top);
  return topUrl !== null && identity.top !== null && sameSite(topUrl, identity.top);
}

/** Queues a page's shared start only when it fits that page, so no site can queue starts for another's address. */
export function announceSharedStart(
  path: string,
  nonce: string,
  identity: WorkerIdentity,
  deps: { origin: string; starts: SharedWorkerStarts },
): boolean {
  const start = readSharedStart(new URL(path, deps.origin), deps.origin);
  if (!start || !startFits(start, identity)) return false;
  deps.starts.announce(path, nonce, identity);
  return true;
}

/** Announced shared starts per address, each handed to one script request, newest first. */
export class SharedWorkerStarts {
  readonly #ttlMs: number;
  readonly #perPath: number;
  readonly #limit: number;
  readonly #now: () => number;
  readonly #byPath = new Map<string, Announced[]>();
  readonly #waiting = new Map<string, Array<(entry: Announced) => void>>();
  #size = 0;

  constructor(options: { ttlMs?: number; perPath?: number; limit?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? SHARED_START_TTL_MS;
    this.#perPath = options.perPath ?? 16;
    this.#limit = options.limit ?? 500;
    this.#now = options.now ?? Date.now;
  }

  announce(path: string, nonce: string, identity: WorkerIdentity): void {
    const entry = { nonce, identity, at: this.#now() };
    const waiter = this.#waiting.get(path)?.shift();
    if (waiter) {
      if (this.#waiting.get(path)?.length === 0) this.#waiting.delete(path);
      waiter(entry);
      return;
    }
    this.#prune();
    const list = this.#byPath.get(path) ?? [];
    list.push(entry);
    this.#byPath.set(path, list);
    this.#size++;
    if (list.length > this.#perPath) this.#drop(path, 0);
    if (this.#size > this.#limit) this.#evictFromLargest();
  }

  take(path: string, waitMs = SHARED_START_WAIT_MS): Promise<{ nonce: string; identity: WorkerIdentity } | null> {
    this.#prune();
    // The newest, since older ones are more likely what joining pages left behind.
    const list = this.#byPath.get(path);
    const entry = list?.[list.length - 1];
    if (list && entry) {
      this.#drop(path, list.length - 1);
      return Promise.resolve({ nonce: entry.nonce, identity: entry.identity });
    }
    if (waitMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (found: Announced) => {
        clearTimeout(timer);
        resolve({ nonce: found.nonce, identity: found.identity });
      };
      const timer = setTimeout(() => {
        const waiters = this.#waiting.get(path) ?? [];
        const index = waiters.indexOf(waiter);
        if (index !== -1) waiters.splice(index, 1);
        if (waiters.length === 0) this.#waiting.delete(path);
        resolve(null);
      }, waitMs);
      const waiters = this.#waiting.get(path) ?? [];
      waiters.push(waiter);
      this.#waiting.set(path, waiters);
    });
  }

  #drop(path: string, index: number): void {
    const list = this.#byPath.get(path);
    if (!list) return;
    list.splice(index, 1);
    this.#size--;
    if (list.length === 0) this.#byPath.delete(path);
  }

  #prune(): void {
    const now = this.#now();
    for (const [path, list] of this.#byPath) {
      while (list.length > 0 && now - list[0]!.at > this.#ttlMs) this.#drop(path, 0);
    }
  }

  /** Drops the oldest start of the site holding the most, so a flood from one site cannot push out another's. */
  #evictFromLargest(): void {
    const counts = new Map<string, number>();
    for (const list of this.#byPath.values()) {
      for (const entry of list) counts.set(siteOf(entry), (counts.get(siteOf(entry)) ?? 0) + 1);
    }
    let largest: string | null = null;
    for (const [site, count] of counts) if (largest === null || count > counts.get(largest)!) largest = site;
    let oldest: { path: string; index: number; at: number } | null = null;
    for (const [path, list] of this.#byPath) {
      const index = list.findIndex((entry) => siteOf(entry) === largest);
      const at = list[index]?.at;
      if (at !== undefined && (oldest === null || at < oldest.at)) oldest = { path, index, at };
    }
    if (oldest) this.#drop(oldest.path, oldest.index);
  }
}

/**
 * Answers a shared worker's script request: 404 for any other request, 403 when no fitting page announced the start in
 * time, else the bootstrap with that page's nonce, so the runtime import binds the worker to it.
 */
export async function answerSharedWorker(
  request: { destination: string },
  url: URL,
  deps: { origin: string; runtimePath: string; starts: SharedWorkerStarts },
): Promise<Response> {
  if (request.destination !== "sharedworker") return refused(404);
  const start = readSharedStart(url, deps.origin);
  if (!start) return refused(403);
  const announced = await deps.starts.take(url.pathname + url.search, SHARED_START_WAIT_MS);
  if (!announced || !startFits(start, announced.identity)) return refused(403);
  const code = workerBootstrapCode({
    runtimeUrl: deps.origin + deps.runtimePath,
    nonce: announced.nonce,
    scriptUrl: start.scriptUrl,
    base: start.base.href,
    partition: start.partition,
    module: start.module,
  });
  return new Response(code, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function refused(status: number): Response {
  return new Response(null, { status, headers: inertHeaders() });
}

function siteOf(entry: Announced): string {
  return parse(entry.identity.page)?.origin ?? "";
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
