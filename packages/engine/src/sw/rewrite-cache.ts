import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import type { BodyKind } from "./body.ts";

export interface Validators {
  etag: string | null;
  lastModified: string | null;
  length: string | null;
}

/** A stable key for a rewrite, or null when the response carries nothing to revalidate against. */
export function cacheKey(target: URL, kind: BodyKind, validators: Validators): string | null {
  const validator =
    validators.etag ??
    (validators.lastModified && validators.length ? `${validators.lastModified}|${validators.length}` : null);
  if (!validator) return null;
  return `https://girici.invalid/rw/${PROTOCOL_VERSION}/${kind}/${encodeURIComponent(`${target.href}|${validator}`)}`;
}

const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;

/** Rewrites live in memory only, so nothing the page could write into a cache is ever served as a script. */
export class RewriteMemo {
  readonly #entries = new Map<string, string>();
  #bytes = 0;

  constructor(private readonly maxBytes = DEFAULT_MAX_BYTES) {}

  get(key: string): string | null {
    const text = this.#entries.get(key);
    if (text === undefined) return null;
    this.#entries.delete(key);
    this.#entries.set(key, text);
    return text;
  }

  set(key: string, text: string): void {
    const size = 2 * text.length;
    if (size > this.maxBytes) return;
    this.#drop(key);
    this.#entries.set(key, text);
    this.#bytes += size;
    for (const oldest of this.#entries.keys()) {
      if (this.#bytes <= this.maxBytes) break;
      this.#drop(oldest);
    }
  }

  #drop(key: string): void {
    const text = this.#entries.get(key);
    if (text === undefined) return;
    this.#entries.delete(key);
    this.#bytes -= 2 * text.length;
  }
}
