import { rewriteUrl } from "../shared/url-rewrite.ts";

const REFRESH = /^\s*(\d+)\s*(?:[;,]\s*(?:url\s*=\s*)?(['"]?)(.*?)\2\s*)?$/i;

/** Accepts the syntax variants of the HTML declarative refresh steps; anything else is left for the browser to reject. */
export function rewriteRefresh(value: string, base: URL, origin: string): string {
  const match = REFRESH.exec(value);
  const target = match?.[3];
  if (!match || !target) return value;
  return `${match[1]}; url=${rewriteUrl(target, base, origin)}`;
}
