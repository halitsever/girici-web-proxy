import {
  hashOf,
  hostOf,
  indexOf,
  parseUrl,
  pathnameOf,
  protocolOf,
  searchOf,
  sliceOf,
  startsWith,
  urlPart,
} from "./primordials.ts";

export const PROXY_PREFIX = "/~/";
export const RELAY_PREFIX = "/_g/r/";

/** The UI and the engine own these paths; any other path on our origin belongs to a proxied site. */
export function isReservedPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/robots.txt" || startsWith(pathname, "/_g/");
}

/** The path stays structured instead of encoded, so the browser's own relative URL resolution keeps working. */
export function encodeUrl(url: URL): string {
  return `${PROXY_PREFIX}${schemeOf(url)}/${hostOf(url)}${pathnameOf(url)}${searchOf(url)}${hashOf(url)}`;
}

export function decodeUrl(pathAndQuery: string): URL | null {
  return parseTail(pathAndQuery, PROXY_PREFIX);
}

export function relayPathFor(url: URL): string {
  return `${RELAY_PREFIX}${schemeOf(url)}/${hostOf(url)}${pathnameOf(url)}${searchOf(url)}`;
}

export function targetFromRelayPath(pathAndQuery: string): URL | null {
  return parseTail(pathAndQuery, RELAY_PREFIX);
}

function schemeOf(url: URL): "http" | "https" {
  const protocol = protocolOf(url);
  if (protocol === "http:") return "http";
  if (protocol === "https:") return "https";
  throw new TypeError(`Only http and https URLs can be proxied, got ${protocol}`);
}

function parseTail(pathAndQuery: string, prefix: string): URL | null {
  if (!startsWith(pathAndQuery, prefix)) return null;
  const rest = sliceOf(pathAndQuery, prefix.length);
  const slash = indexOf(rest, "/");
  if (slash <= 0) return null;
  const scheme = sliceOf(rest, 0, slash);
  if (scheme !== "http" && scheme !== "https") return null;
  const remainder = sliceOf(rest, slash + 1);
  if (!remainder || startsWith(remainder, "/")) return null;

  const url = parseUrl(`${scheme}://${remainder}`);
  if (!url || urlPart(url, "username") || urlPart(url, "password") || !urlPart(url, "hostname")) return null;
  return url;
}
