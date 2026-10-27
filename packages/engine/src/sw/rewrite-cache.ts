import { PROTOCOL_VERSION } from "../shared/protocol.ts";
import type { BodyKind } from "./body.ts";

/** The Cache API surface the rewrite cache needs, so a fake stands in for it under test. */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

/** The named cache holding rewritten bodies; dropped on engine updates by the activate cleanup. */
export const REWRITE_CACHE = "girici:rw";

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

export async function readRewritten(key: string, cache: CacheLike): Promise<string | null> {
  const response = await cache.match(key);
  return response ? response.text() : null;
}

export async function writeRewritten(key: string, text: string, cache: CacheLike): Promise<void> {
  await cache.put(key, new Response(text));
}
