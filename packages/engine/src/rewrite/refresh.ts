import { exec } from "../shared/primordials.ts";
import { rewriteUrl } from "../shared/url-rewrite.ts";

const REFRESH = /^\s*(\d+)\s*(?:[;,]\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*)?$/i;

/** Accepts the syntax variants of the HTML declarative refresh steps; anything else is left for the browser to reject. */
export function rewriteRefresh(
  value: string,
  base: URL,
  origin: string,
  swapBlob: (url: string) => string = (url) => url,
  owner?: string,
): string {
  return mapRefresh(value, (target) => swapBlob(rewriteUrl(target, base, origin, owner)));
}

/** Maps the URL of a refresh value; a value whose URL stays the same comes back exactly as written. */
export function mapRefresh(value: string, map: (url: string) => string): string {
  const match = exec(REFRESH, value);
  const target = match?.[3];
  if (!match || !target) return value;
  const mapped = map(target);
  return mapped === target ? value : `${match[1]}; url=${mapped}`;
}
