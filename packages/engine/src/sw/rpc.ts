import { COOKIE_BATCH_LIMIT, PROTOCOL_VERSION } from "../shared/protocol.ts";
import { scriptCookieKey, type CookieService } from "./cookies/jar.ts";

interface Waiter {
  seq: number;
  resolve(): void;
}

/** Script cookie writes arrive here, and requests their page sends right after can wait until they have landed. */
export class CookieRpc {
  readonly #cookies: CookieService;
  readonly #maxWait: number;
  readonly #orderWait: number;
  readonly #processed = new Map<string, number>();
  /** Per page, the seq of the last write applied to each cookie, so a late batch cannot undo a newer one. */
  readonly #written = new Map<string, Map<string, number>>();
  readonly #waiters = new Map<string, Set<Waiter>>();
  /** The batch each page is applying, so two of its batches never interleave. */
  readonly #applying = new Map<string, Promise<void>>();

  constructor(cookies: CookieService, options: { maxWait?: number; orderWait?: number } = {}) {
    this.#cookies = cookies;
    this.#maxWait = options.maxWait ?? 100;
    this.#orderWait = options.orderWait ?? 1000;
  }

  /**
   * The page URL comes from the calling client rather than the body, so a page can only write its own cookies.
   * A blocked write (a third-party frame while blocking is on) is dropped but still releases waiting requests.
   */
  async handle(
    request: Request,
    clientId: string,
    pageUrl: URL | null,
    options: { blocked?: boolean } = {},
  ): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof body !== "object" || body === null) return new Response(null, { status: 400 });
    const { v, seq, cookie, cookies } = body as Record<string, unknown>;
    if (v !== PROTOCOL_VERSION) return new Response(null, { status: 409 });
    const batch = cookies === undefined ? (typeof cookie === "string" ? [cookie] : null) : batchOf(cookies, cookie);
    if (typeof seq !== "number" || !batch || !pageUrl) return new Response(null, { status: 400 });

    // A page sends a batch without waiting for the one before, so that one may still be on its way.
    const first = seq - batch.length + 1;
    const done = this.#processed.get(clientId);
    if (clientId !== "" && done !== undefined && done < first - 1)
      await this.#until(clientId, first - 1, this.#orderWait);
    await this.#serial(clientId, async () => {
      if (!options.blocked) await this.#apply(clientId, pageUrl, batch, first);
      this.#markProcessed(clientId, seq);
    });
    const visible = options.blocked ? [] : await this.#cookies.snapshot(pageUrl);
    return new Response(JSON.stringify({ cookies: visible }), {
      headers: { "content-type": "application/json" },
    });
  }

  /** In order, so the jar ends with the page's last write; a write to a cookie a later write already set is skipped. */
  async #apply(clientId: string, pageUrl: URL, batch: string[], first: number): Promise<void> {
    let written = this.#written.get(clientId);
    if (!written && clientId !== "") this.#written.set(clientId, (written = new Map()));
    for (let index = 0; index < batch.length; index++) {
      const key = written && scriptCookieKey(pageUrl, batch[index]!);
      if (written && key) {
        if ((written.get(key) ?? 0) >= first + index) continue;
        written.set(key, first + index);
      }
      await this.#cookies.setFromScript(pageUrl, batch[index]!);
    }
  }

  waitFor(clientId: string, seq: number): Promise<void> {
    return this.#until(clientId, seq, this.#maxWait);
  }

  #until(clientId: string, seq: number, maxWait: number): Promise<void> {
    if ((this.#processed.get(clientId) ?? 0) >= seq) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(clientId) ?? new Set<Waiter>();
      const waiter: Waiter = {
        seq,
        resolve: () => {
          clearTimeout(timer);
          waiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.resolve, maxWait);
      waiters.add(waiter);
      this.#waiters.set(clientId, waiters);
    });
  }

  clientIds(): string[] {
    return [...this.#processed.keys()];
  }

  forget(clientId: string): void {
    this.#processed.delete(clientId);
    this.#written.delete(clientId);
    this.#applying.delete(clientId);
    for (const waiter of this.#waiters.get(clientId) ?? []) waiter.resolve();
    this.#waiters.delete(clientId);
  }

  #serial(clientId: string, run: () => Promise<void>): Promise<void> {
    if (clientId === "") return run();
    const mine = (this.#applying.get(clientId) ?? Promise.resolve()).then(run);
    const settled = mine.catch(() => {});
    this.#applying.set(clientId, settled);
    void settled.then(() => {
      if (this.#applying.get(clientId) === settled) this.#applying.delete(clientId);
    });
    return mine;
  }

  #markProcessed(clientId: string, seq: number): void {
    const processed = Math.max(this.#processed.get(clientId) ?? 0, seq);
    this.#processed.set(clientId, processed);
    for (const waiter of this.#waiters.get(clientId) ?? []) {
      if (waiter.seq <= processed) waiter.resolve();
    }
  }
}

/** A batch body's cookies: 1 to COOKIE_BATCH_LIMIT strings, and no single `cookie` beside them. */
function batchOf(cookies: unknown, cookie: unknown): string[] | null {
  if (cookie !== undefined || !Array.isArray(cookies)) return null;
  if (cookies.length === 0 || cookies.length > COOKIE_BATCH_LIMIT) return null;
  return cookies.every((text) => typeof text === "string") ? (cookies as string[]) : null;
}
