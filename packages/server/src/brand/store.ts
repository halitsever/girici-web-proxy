import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthStore } from "../auth/store.ts";
import type { LogoType } from "./logo.ts";

export interface BrandInfo {
  name: string | null;
  logo: string | null;
}

interface StoredLogo {
  type: LogoType;
  sha256: string;
  bytes: Buffer;
}

/** The instance name (in settings) and logo (a file in the data directory). */
export class BrandStore {
  readonly #dir: string;
  readonly #store: AuthStore;
  #cached: StoredLogo | null = null;
  /** The recorded logo whose file was missing, so a lost file costs one disk read, not one per request. */
  #missing: string | null = null;

  constructor(dir: string, store: AuthStore) {
    this.#dir = dir;
    this.#store = store;
  }

  info(): BrandInfo {
    const logo = this.logo();
    return {
      name: this.#store.brandName(),
      logo: logo ? `/_g/brand/logo?v=${logo.sha256.slice(0, 16)}` : null,
    };
  }

  /** A recorded logo whose file is gone counts as none. */
  logo(): StoredLogo | null {
    const meta = this.#store.brandLogo();
    if (!meta) return null;
    if (this.#cached?.sha256 === meta.sha256) return this.#cached;
    if (this.#missing === meta.sha256) return null;
    try {
      this.#cached = { ...meta, bytes: readFileSync(this.#file()) };
    } catch {
      this.#missing = meta.sha256;
      return null;
    }
    return this.#cached;
  }

  /** An absent key leaves that part alone; null clears it. */
  update(change: { name?: string | null; logo?: { bytes: Buffer; type: LogoType } | null }): BrandInfo {
    // The file goes first, so a failed write leaves the name and the recorded logo as they were.
    if (change.logo) {
      mkdirSync(this.#dir, { recursive: true });
      const temp = join(this.#dir, "logo.tmp");
      writeFileSync(temp, change.logo.bytes);
      renameSync(temp, this.#file());
      this.#missing = null;
      this.#store.setBrandLogo({
        type: change.logo.type,
        sha256: createHash("sha256").update(change.logo.bytes).digest("hex"),
      });
    } else if (change.logo === null) {
      this.#store.setBrandLogo(null);
      rmSync(this.#file(), { force: true });
      this.#cached = null;
    }
    if (change.name !== undefined) this.#store.setBrandName(change.name);
    return this.info();
  }

  #file(): string {
    return join(this.#dir, "logo");
  }
}
