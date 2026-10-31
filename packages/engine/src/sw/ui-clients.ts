import type { ClientRecordStore } from "./client-records.ts";
import { classifyRequest, hasUiShape, isUiRoute, type ClientShape, type UiClientSet } from "./route.ts";

const STORE = "ui";
const SEEDED = "#seeded";
const LIMIT = 200;

/** A top-level page load of one of the UI's routes. */
export function isUiNavigation(
  request: { mode: RequestMode; destination: RequestDestination; method: string },
  url: URL,
  origin: string,
): boolean {
  return (
    request.mode === "navigate" &&
    request.destination === "document" &&
    request.method === "GET" &&
    isUiRoute(url, origin)
  );
}

/**
 * A UI navigation that loads the UI. A proxied page's load of /settings or /account is redirected into its own site
 * under the same client ID, so it does not count. Its load of /, /_g/login or /_g/setup does: those paths are never a
 * site's, and the shell's COOP and frame-ancestors keep the page from scripting that window.
 */
export function loadsUi(
  request: { mode: RequestMode; destination: RequestDestination; method: string; referrer: string },
  url: URL,
  origin: string,
): boolean {
  if (!isUiNavigation(request, url, origin)) return false;
  const referrer = request.referrer || null;
  return classifyRequest({ url: url.href, origin, navigation: true, clientUrl: null, referrer }).kind === "passthrough";
}

export interface UiClientsOptions {
  limit?: number;
  /** IDs of the windows that still exist. Without it every ID counts as alive. */
  liveIds?: () => Promise<ReadonlySet<string>>;
}

/** Girici UI tabs, known by the client IDs their own navigations produced. Records outlive worker restarts. */
export class UiClients implements UiClientSet {
  readonly #records: ClientRecordStore;
  readonly #limit: number;
  readonly #liveIds: () => Promise<ReadonlySet<string> | null>;
  /** Client ID to the time it was added, oldest first. */
  readonly #ids = new Map<string, number>();
  // Only records read without the marker allow a seed, so an unread history never seeds.
  #seedable = false;
  #seedTried = false;
  #loaded: Promise<void> | null = null;
  #trimming = false;

  constructor(records: ClientRecordStore, options: UiClientsOptions = {}) {
    this.#records = records;
    this.#limit = options.limit ?? LIMIT;
    this.#liveIds = options.liveIds ?? (async () => null);
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  add(id: string): void {
    const at = Date.now();
    this.#ids.delete(id);
    this.#ids.set(id, at);
    this.#records.put(STORE, id, at).catch(() => {});
    void this.#trim();
  }

  /**
   * The first activation records the UI tabs already open, since they loaded before anything could record them. Later
   * activations do not, because proxied pages may be open by then.
   */
  async seedOnce(clients: readonly ClientShape[], origin: string): Promise<void> {
    if (this.#seedTried) return;
    this.#seedTried = true;
    await this.ready();
    if (!this.#seedable) return;
    try {
      await this.#records.put(STORE, SEEDED, true);
    } catch {
      // A seed nothing remembers would run again at a later activation, with proxied pages open.
      return;
    }
    for (const client of clients) if (hasUiShape(client, origin)) this.add(client.id);
  }

  async #load(): Promise<void> {
    let records: Array<{ key: string; value: unknown }>;
    try {
      records = await this.#records.load(STORE);
    } catch {
      // The next ready() reads again.
      this.#loaded = null;
      return;
    }
    const addedMeanwhile = [...this.#ids];
    this.#ids.clear();
    this.#seedable = !records.some((record) => record.key === SEEDED);
    const stored = records
      .filter((record) => record.key !== SEEDED)
      .map(({ key, value }) => [key, typeof value === "number" ? value : 0] as const)
      .sort((a, b) => a[1] - b[1]);
    for (const [id, at] of [...stored, ...addedMeanwhile]) {
      this.#ids.delete(id);
      this.#ids.set(id, at);
    }
    void this.#trim();
  }

  /**
   * IDs without a window go first, oldest first, so loads a page floods in cannot push out an open UI tab. A new load
   * has no window until its page arrives, but it is the newest of those.
   */
  async #trim(): Promise<void> {
    if (this.#trimming || this.#ids.size <= this.#limit) return;
    this.#trimming = true;
    try {
      const live = await this.#liveIds().catch(() => null);
      const alive = (id: string) => !live || live.has(id);
      const order = [...this.#ids.keys()].sort((a, b) => Number(alive(a)) - Number(alive(b)));
      for (const id of order) {
        if (this.#ids.size <= this.#limit) break;
        this.#ids.delete(id);
        this.#records.delete(STORE, id).catch(() => {});
      }
    } finally {
      this.#trimming = false;
    }
  }
}
