import { PROTOCOL_VERSION, SHARED_WORKER_PATH, WORKER_NONCE_PARAM } from "../shared/protocol.ts";
import { SHARED_PATH_LIMIT } from "../shared/worker-boot.ts";
import type { ClientRecordStore } from "./client-records.ts";

const STORE = "workers";
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;

/** The page that started a worker: its real URL and the schemeful site of its top-level page. */
export interface WorkerIdentity {
  page: string;
  top: string | null;
}

export interface WorkerRegistryOptions {
  /** How long a worker's runtime import waits for the announcement its page sent first. */
  waitMs?: number;
  /** How long an announced nonce stays claimable. */
  ttlMs?: number;
  limit?: number;
  /** How many unclaimed nonces one client may hold, so a flood from one page cannot push out another's. */
  perClient?: number;
}

/** The nonce on a worker's runtime import, if well-formed. */
export function readNonce(url: URL): string | null {
  const nonce = url.searchParams.get(WORKER_NONCE_PARAM);
  return nonce !== null && NONCE.test(nonce) ? nonce : null;
}

/**
 * The nonce in an announcement body and, for a shared worker, the path and query of its address, written as the
 * browser will request it. Null when the body is not an announcement or names any other address.
 */
export function readAnnouncement(body: unknown): { nonce: string; shared: string | null } | null {
  const { v, n, w } = (body ?? {}) as { v?: unknown; n?: unknown; w?: unknown };
  if (v !== PROTOCOL_VERSION || typeof n !== "string" || !NONCE.test(n)) return null;
  if (typeof w === "string" && w.length > SHARED_PATH_LIMIT) return { nonce: n, shared: null };
  if (w === undefined) return { nonce: n, shared: null };
  if (typeof w !== "string" || !w.startsWith(`${SHARED_WORKER_PATH}?`)) return null;
  const address = new URL(w, "https://shared.invalid");
  return { nonce: n, shared: address.pathname + address.search };
}

/** Answers an announcement: 400 when the body is not one, 403 when the caller has no identity to bind the nonce to. */
export async function answerAnnouncement(
  request: Request,
  from: string,
  callerIdentity: () => Promise<WorkerIdentity | null>,
  registry: WorkerRegistry,
  onShared?: (path: string, nonce: string, identity: WorkerIdentity) => void,
): Promise<Response> {
  let announcement: { nonce: string; shared: string | null } | null;
  try {
    announcement = readAnnouncement(await request.json());
  } catch {
    announcement = null;
  }
  if (!announcement) return new Response(null, { status: 400 });
  const identity = await callerIdentity();
  if (!identity) return new Response(null, { status: 403 });
  registry.announce(announcement.nonce, identity, from);
  if (announcement.shared !== null) onShared?.(announcement.shared, announcement.nonce, identity);
  return new Response(null, { status: 204 });
}

/**
 * Binds each worker to the page that started it. The page announces a nonce before the worker exists, and the worker
 * names it on its first request, so a worker never vouches for its own site. Bindings outlive worker restarts.
 */
export class WorkerRegistry {
  readonly #records: ClientRecordStore;
  readonly #waitMs: number;
  readonly #ttlMs: number;
  readonly #limit: number;
  readonly #perClient: number;
  /** Announced nonces and the client that announced each, oldest first. */
  readonly #nonces = new Map<string, { identity: WorkerIdentity; at: number; from: string }>();
  /** Claims that came before their announcement. */
  readonly #waiting = new Map<string, (identity: WorkerIdentity) => void>();
  readonly #pending = new Map<string, Promise<WorkerIdentity | null>>();
  /** Client ID to its binding, oldest first. */
  readonly #bound = new Map<string, { identity: WorkerIdentity; at: number }>();
  #loaded: Promise<void> | null = null;

  constructor(records: ClientRecordStore, options: WorkerRegistryOptions = {}) {
    this.#records = records;
    this.#waitMs = options.waitMs ?? 1000;
    this.#ttlMs = options.ttlMs ?? 30_000;
    this.#limit = options.limit ?? 500;
    this.#perClient = options.perClient ?? 64;
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  announce(nonce: string, identity: WorkerIdentity, from: string, now = Date.now()): void {
    const waiter = this.#waiting.get(nonce);
    if (waiter) {
      this.#waiting.delete(nonce);
      waiter(identity);
      return;
    }
    // The first announcement holds; a nonce is never rebound to another page.
    if (this.#nonces.has(nonce)) return;
    for (const [key, entry] of this.#nonces) if (now - entry.at > this.#ttlMs) this.#nonces.delete(key);
    const own = this.#noncesFrom(from);
    if (own.length >= this.#perClient) this.#nonces.delete(own[0]!);
    this.#nonces.set(nonce, { identity, at: now, from });
    if (this.#nonces.size > this.#limit) this.#evictFromLargest();
  }

  /** A worker keeps its first binding, so a second nonce cannot move it to another site. */
  claim(clientId: string, nonce: string): Promise<WorkerIdentity | null> {
    const known = this.#pending.get(clientId) ?? this.#boundIdentity(clientId);
    if (known) return known;
    const claimed = this.#claim(clientId, nonce);
    // Stored before it settles, so the worker's next requests wait for the same answer, but not for the disk.
    this.#pending.set(
      clientId,
      claimed.then(({ identity }) => {
        this.#pending.delete(clientId);
        return identity;
      }),
    );
    // The caller keeps the service worker alive until the binding is stored too.
    return claimed.then(async ({ identity, stored }) => {
      await stored;
      return identity;
    });
  }

  async identityOf(clientId: string): Promise<WorkerIdentity | null> {
    const known = this.#pending.get(clientId) ?? this.#boundIdentity(clientId);
    if (known) {
      this.#touch(clientId);
      return known;
    }
    await this.ready();
    return this.#bound.get(clientId)?.identity ?? null;
  }

  async #claim(clientId: string, nonce: string): Promise<{ identity: WorkerIdentity | null; stored?: Promise<void> }> {
    // A binding from before a restart outranks any nonce, so it is read first.
    await this.ready();
    const bound = this.#bound.get(clientId);
    if (bound) return { identity: bound.identity };
    const identity = await this.#take(nonce);
    return identity ? { identity, stored: this.#bind(clientId, identity) } : { identity };
  }

  /** Moves a worker that is still making requests to the back of the eviction order, in memory only. */
  #touch(clientId: string): void {
    const bound = this.#bound.get(clientId);
    if (!bound) return;
    this.#bound.delete(clientId);
    this.#bound.set(clientId, bound);
  }

  #noncesFrom(from: string): string[] {
    const keys: string[] = [];
    for (const [key, entry] of this.#nonces) if (entry.from === from) keys.push(key);
    return keys;
  }

  /** Drops the oldest nonce of the client holding the most, so clients below their cap keep theirs. */
  #evictFromLargest(): void {
    const counts = new Map<string, number>();
    for (const entry of this.#nonces.values()) counts.set(entry.from, (counts.get(entry.from) ?? 0) + 1);
    let largest: string | null = null;
    for (const [from, count] of counts) if (largest === null || count > counts.get(largest)!) largest = from;
    if (largest !== null) this.#nonces.delete(this.#noncesFrom(largest)[0]!);
  }

  #boundIdentity(clientId: string): Promise<WorkerIdentity> | undefined {
    const bound = this.#bound.get(clientId);
    return bound && Promise.resolve(bound.identity);
  }

  #take(nonce: string): Promise<WorkerIdentity | null> {
    const entry = this.#nonces.get(nonce);
    if (entry) {
      this.#nonces.delete(nonce);
      if (Date.now() - entry.at <= this.#ttlMs) return Promise.resolve(entry.identity);
    }
    if (this.#waiting.has(nonce)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(nonce);
        resolve(null);
      }, this.#waitMs);
      this.#waiting.set(nonce, (identity) => {
        clearTimeout(timer);
        resolve(identity);
      });
    });
  }

  #bind(clientId: string, identity: WorkerIdentity): Promise<void> {
    const at = Date.now();
    this.#bound.delete(clientId);
    this.#bound.set(clientId, { identity, at });
    const stored = this.#records.put(STORE, clientId, { ...identity, at }).catch(() => {});
    for (const dropped of trim(this.#bound, this.#limit)) this.#records.delete(STORE, dropped).catch(() => {});
    return stored;
  }

  async #load(): Promise<void> {
    let records: Array<{ key: string; value: unknown }>;
    try {
      records = await this.#records.load(STORE);
    } catch {
      // The next ready() reads again; until then unknown workers stay unbound.
      this.#loaded = null;
      return;
    }
    const boundMeanwhile = [...this.#bound];
    this.#bound.clear();
    const stored = records
      .map(({ key, value }) => [key, storedBinding(value)] as const)
      .filter((record): record is readonly [string, { identity: WorkerIdentity; at: number }] => record[1] !== null)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, binding] of [...stored, ...boundMeanwhile]) {
      this.#bound.delete(id);
      this.#bound.set(id, binding);
    }
    for (const dropped of trim(this.#bound, this.#limit)) this.#records.delete(STORE, dropped).catch(() => {});
  }
}

function storedBinding(value: unknown): { identity: WorkerIdentity; at: number } | null {
  const { page, top, at } = (value ?? {}) as { page?: unknown; top?: unknown; at?: unknown };
  if (typeof page !== "string" || !parses(page) || (typeof top !== "string" && top !== null)) return null;
  return { identity: { page, top }, at: typeof at === "number" ? at : 0 };
}

function parses(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Drops the oldest entries past the limit and returns their keys. */
function trim<V>(map: Map<string, V>, limit: number): string[] {
  const dropped: string[] = [];
  for (const key of map.keys()) {
    if (map.size <= limit) break;
    map.delete(key);
    dropped.push(key);
  }
  return dropped;
}
