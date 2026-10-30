/** The Cache API surface the store needs, so a fake stands in for it under test. */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

export interface RuntimeFile {
  path: string;
  sha256: string;
}

export interface RuntimeStoreDeps {
  open(): Promise<CacheLike>;
  fetch(path: string): Promise<Response>;
  digest(bytes: ArrayBuffer): Promise<string>;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Serves the page runtime only after its bytes match the digest baked into this worker at build time. */
export class RuntimeStore {
  readonly #expected: Map<string, string>;
  readonly #memory = new Map<string, ArrayBuffer>();

  constructor(
    files: readonly RuntimeFile[],
    private readonly deps: RuntimeStoreDeps,
  ) {
    this.#expected = new Map(files.map((file) => [file.path, file.sha256]));
  }

  has(path: string): boolean {
    return this.#expected.has(path);
  }

  async install(): Promise<void> {
    for (const path of this.#expected.keys()) {
      const bytes = await this.#fromNetwork(path);
      if (!bytes) continue;
      this.#memory.set(path, bytes);
      await this.#store(path, bytes);
    }
  }

  async bytes(path: string): Promise<ArrayBuffer | null> {
    const known = this.#memory.get(path);
    if (known) return known;
    if (!this.has(path)) return null;
    const cached = await this.#fromCache(path);
    if (cached) {
      this.#memory.set(path, cached);
      return cached;
    }
    const fresh = await this.#fromNetwork(path);
    if (!fresh) return null;
    this.#memory.set(path, fresh);
    await this.#store(path, fresh);
    return fresh;
  }

  async response(path: string): Promise<Response> {
    const bytes = await this.bytes(path);
    if (!bytes) return Response.error();
    return new Response(bytes.slice(0), {
      status: 200,
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }

  async #verified(path: string, bytes: ArrayBuffer): Promise<boolean> {
    return (await this.deps.digest(bytes)) === this.#expected.get(path);
  }

  async #fromNetwork(path: string): Promise<ArrayBuffer | null> {
    try {
      const response = await this.deps.fetch(path);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      return (await this.#verified(path, bytes)) ? bytes : null;
    } catch {
      return null;
    }
  }

  async #fromCache(path: string): Promise<ArrayBuffer | null> {
    try {
      const response = await (await this.deps.open()).match(path);
      if (!response) return null;
      const bytes = await response.arrayBuffer();
      return (await this.#verified(path, bytes)) ? bytes : null;
    } catch {
      return null;
    }
  }

  async #store(path: string, bytes: ArrayBuffer): Promise<void> {
    try {
      await (await this.deps.open()).put(path, new Response(bytes.slice(0)));
    } catch {
      // The copy in memory is enough for this worker's lifetime.
    }
  }
}
