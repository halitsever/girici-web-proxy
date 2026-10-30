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
 * A UI navigation that loads the UI. One from a proxied page can be sent back into that site instead, and a same-origin
 * redirect keeps the client ID, so it must not count.
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

/** Girici UI tabs, known by the client IDs their own navigations produced. Records outlive worker restarts. */
export class UiClients implements UiClientSet {
  readonly #records: ClientRecordStore;
  readonly #limit: number;
  /** Client ID to the time it was added, oldest first. */
  readonly #ids = new Map<string, number>();
  // Stays set when the records cannot be read, so an unknown history never seeds.
  #seeded = true;
  #loaded: Promise<void> | null = null;

  constructor(records: ClientRecordStore, options: { limit?: number } = {}) {
    this.#records = records;
    this.#limit = options.limit ?? LIMIT;
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
    this.#trim();
  }

  /**
   * The first activation records the UI tabs already open, since they loaded before anything could record them. Later
   * activations do not, because proxied pages may be open by then.
   */
  async seedOnce(clients: readonly ClientShape[], origin: string): Promise<void> {
    await this.ready();
    if (this.#seeded) return;
    this.#seeded = true;
    for (const client of clients) if (hasUiShape(client, origin)) this.add(client.id);
    await this.#records.put(STORE, SEEDED, true).catch(() => {});
  }

  async #load(): Promise<void> {
    let records: Array<{ key: string; value: unknown }>;
    try {
      records = await this.#records.load(STORE);
    } catch {
      return;
    }
    const addedMeanwhile = [...this.#ids];
    this.#ids.clear();
    this.#seeded = records.some((record) => record.key === SEEDED);
    const stored = records
      .filter((record) => record.key !== SEEDED)
      .map(({ key, value }) => [key, typeof value === "number" ? value : 0] as const)
      .sort((a, b) => a[1] - b[1]);
    for (const [id, at] of [...stored, ...addedMeanwhile]) {
      this.#ids.delete(id);
      this.#ids.set(id, at);
    }
    this.#trim();
  }

  #trim(): void {
    for (const id of this.#ids.keys()) {
      if (this.#ids.size <= this.#limit) return;
      this.#ids.delete(id);
      this.#records.delete(STORE, id).catch(() => {});
    }
  }
}
