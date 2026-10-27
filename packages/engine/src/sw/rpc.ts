import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import type { CookieService } from "./cookies/jar.ts";

interface Waiter {
  seq: number;
  resolve(): void;
}

/** Script cookie writes arrive here, and requests their page sends right after can wait until they have landed. */
export class CookieRpc {
  readonly #cookies: CookieService;
  readonly #maxWait: number;
  readonly #processed = new Map<string, number>();
  readonly #waiters = new Map<string, Set<Waiter>>();

  constructor(cookies: CookieService, options: { maxWait?: number } = {}) {
    this.#cookies = cookies;
    this.#maxWait = options.maxWait ?? 100;
  }

  /** The page URL comes from the calling client rather than the body, so a page can only write its own cookies. */
  async handle(request: Request, clientId: string, pageUrl: URL | null): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof body !== "object" || body === null) return new Response(null, { status: 400 });
    const { v, seq, cookie } = body as Record<string, unknown>;
    if (v !== PROTOCOL_VERSION) return new Response(null, { status: 409 });
    if (typeof seq !== "number" || typeof cookie !== "string" || !pageUrl) return new Response(null, { status: 400 });

    await this.#cookies.setFromScript(pageUrl, cookie);
    this.#markProcessed(clientId, seq);
    return new Response(JSON.stringify({ cookies: await this.#cookies.snapshot(pageUrl) }), {
      headers: { "content-type": "application/json" },
    });
  }

  waitFor(clientId: string, seq: number): Promise<void> {
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
      const timer = setTimeout(waiter.resolve, this.#maxWait);
      waiters.add(waiter);
      this.#waiters.set(clientId, waiters);
    });
  }

  clientIds(): string[] {
    return [...this.#processed.keys()];
  }

  forget(clientId: string): void {
    this.#processed.delete(clientId);
    for (const waiter of this.#waiters.get(clientId) ?? []) waiter.resolve();
    this.#waiters.delete(clientId);
  }

  #markProcessed(clientId: string, seq: number): void {
    const processed = Math.max(this.#processed.get(clientId) ?? 0, seq);
    this.#processed.set(clientId, processed);
    for (const waiter of this.#waiters.get(clientId) ?? []) {
      if (waiter.seq <= processed) waiter.resolve();
    }
  }
}
