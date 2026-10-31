/** One BotGuard session: mints content-bound poTokens until it expires. */
export interface PoSession {
  mint(contentBinding: string): Promise<string>;
  expiresAt: number;
}

export type CreateSession = () => Promise<PoSession>;

/**
 * Hands out GVS poTokens, holding one BotGuard session until its TTL and sharing
 * a single in-flight setup across callers. Minting failures surface as null, never throw,
 * so a caller can fall back to the plain response.
 */
export class PoTokenMinter {
  #current: PoSession | null = null;
  #expiresAt = 0;
  #pending: Promise<PoSession> | null = null;
  readonly #createSession: CreateSession;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;

  constructor(
    createSession: CreateSession,
    now: () => number = Date.now,
    onError: (error: unknown) => void = () => {},
  ) {
    this.#createSession = createSession;
    this.#now = now;
    this.#onError = onError;
  }

  async mint(contentBinding: string): Promise<string | null> {
    try {
      const session = await this.#session();
      return await session.mint(contentBinding);
    } catch (error) {
      this.#onError(error);
      return null;
    }
  }

  #session(): Promise<PoSession> {
    if (this.#current && this.#now() < this.#expiresAt) return Promise.resolve(this.#current);
    if (!this.#pending) {
      this.#pending = this.#createSession().then(
        (session) => {
          this.#current = session;
          this.#expiresAt = session.expiresAt;
          this.#pending = null;
          return session;
        },
        (error) => {
          this.#pending = null;
          throw error;
        },
      );
    }
    return this.#pending;
  }
}
