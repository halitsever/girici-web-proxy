import { exec } from "../shared/primordials.ts";
import { isBlobUrl, rewriteUrl } from "../shared/url-rewrite.ts";

const REFRESH = /^\s*(\d+)\s*(?:[;,]\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*)?$/i;

/**
 * Accepts the syntax variants of the HTML declarative refresh steps; anything else is left for the browser to reject.
 * Without `swapBlob`, as in the service worker, a refresh to a blob document comes back empty, which the browser
 * ignores: only the page's own runtime can make the bootstrap that blob would need.
 */
export function rewriteRefresh(
  value: string,
  base: URL,
  origin: string,
  swapBlob?: (url: string) => string,
  owner?: string,
): string {
  let blocked = false;
  const next = mapRefresh(value, (target) => {
    const url = rewriteUrl(target, base, origin, owner);
    if (swapBlob) return swapBlob(url);
    if (isBlobUrl(url)) blocked = true;
    return url;
  });
  return blocked ? "" : next;
}

/** Maps the URL of a refresh value; a value whose URL stays the same comes back exactly as written. */
export function mapRefresh(value: string, map: (url: string) => string): string {
  const match = exec(REFRESH, value);
  const target = match?.[3];
  if (!match || !target) return value;
  const mapped = map(target);
  return mapped === target ? value : `${match[1]}; url=${mapped}`;
}
