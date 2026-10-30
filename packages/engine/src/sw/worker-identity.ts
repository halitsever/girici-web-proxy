import { PROTOCOL_VERSION, WORKER_NONCE_PARAM } from "../shared/protocol.ts";
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
}

/** The nonce on a worker's runtime import, if well-formed. */
export function readNonce(url: URL): string | null {
  const nonce = url.searchParams.get(WORKER_NONCE_PARAM);
  return nonce !== null && NONCE.test(nonce) ? nonce : null;
}

/** The nonce in an announcement body, or null when the body is not one. */
export function readAnnouncement(body: unknown): string | null {
  const { v, n } = (body ?? {}) as { v?: unknown; n?: unknown };
  return v === PROTOCOL_VERSION && typeof n === "string" && NONCE.test(n) ? n : null;
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
  /** Announced nonces, oldest first. */
  readonly #nonces = new Map<string, { identity: WorkerIdentity; at: number }>();
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
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  announce(nonce: string, identity: WorkerIdentity, now = Date.now()): void {
    const waiter = this.#waiting.get(nonce);
    if (waiter) {
      this.#waiting.delete(nonce);
      waiter(identity);
      return;
    }
    // The first announcement holds; a nonce is never rebound to another page.
    if (this.#nonces.has(nonce)) return;
    for (const [key, entry] of this.#nonces) if (now - entry.at > this.#ttlMs) this.#nonces.delete(key);
    this.#nonces.set(nonce, { identity, at: now });
    trim(this.#nonces, this.#limit);
  }

  /** A worker keeps its first binding, so a second nonce cannot move it to another site. */
  claim(clientId: string, nonce: string): Promise<WorkerIdentity | null> {
    const known = this.#pending.get(clientId) ?? this.#boundIdentity(clientId);
    if (known) return known;
    const claimed = this.#take(nonce).then((identity) => {
      this.#pending.delete(clientId);
      if (identity) this.#bind(clientId, identity);
      return identity;
    });
    // Stored before it settles, so the worker's next requests wait for the same answer.
    this.#pending.set(clientId, claimed);
    return claimed;
  }

  async identityOf(clientId: string): Promise<WorkerIdentity | null> {
    const known = this.#pending.get(clientId) ?? this.#boundIdentity(clientId);
    if (known) return known;
    await this.ready();
    return this.#bound.get(clientId)?.identity ?? null;
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

  #bind(clientId: string, identity: WorkerIdentity): void {
    const at = Date.now();
    this.#bound.delete(clientId);
    this.#bound.set(clientId, { identity, at });
    this.#records.put(STORE, clientId, { ...identity, at }).catch(() => {});
    for (const dropped of trim(this.#bound, this.#limit)) this.#records.delete(STORE, dropped).catch(() => {});
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
  if (typeof page !== "string" || (typeof top !== "string" && top !== null)) return null;
  return { identity: { page, top }, at: typeof at === "number" ? at : 0 };
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
