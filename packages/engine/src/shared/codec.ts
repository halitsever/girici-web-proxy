export const PROXY_PREFIX = "/~/";
export const RELAY_PREFIX = "/_g/r/";

/** The UI and the engine own these paths; any other path on our origin belongs to a proxied site. */
export function isReservedPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/robots.txt" || pathname.startsWith("/_g/");
}

/** The path stays structured instead of encoded, so the browser's own relative URL resolution keeps working. */
export function encodeUrl(url: URL): string {
  return `${PROXY_PREFIX}${schemeOf(url)}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

export function decodeUrl(pathAndQuery: string): URL | null {
  return parseTail(pathAndQuery, PROXY_PREFIX);
}

export function relayPathFor(url: URL): string {
  return `${RELAY_PREFIX}${schemeOf(url)}/${url.host}${url.pathname}${url.search}`;
}

export function targetFromRelayPath(pathAndQuery: string): URL | null {
  return parseTail(pathAndQuery, RELAY_PREFIX);
}

function schemeOf(url: URL): "http" | "https" {
  if (url.protocol === "http:") return "http";
  if (url.protocol === "https:") return "https";
  throw new TypeError(`Only http and https URLs can be proxied, got ${url.protocol}`);
}

function parseTail(pathAndQuery: string, prefix: string): URL | null {
  if (!pathAndQuery.startsWith(prefix)) return null;
  const rest = pathAndQuery.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const scheme = rest.slice(0, slash);
  if (scheme !== "http" && scheme !== "https") return null;
  const remainder = rest.slice(slash + 1);
  if (!remainder || remainder.startsWith("/")) return null;

  let url: URL;
  try {
    // Safari 17.4, which the UI supports, has no URL.parse.
    url = new URL(`${scheme}://${remainder}`);
  } catch {
    return null;
  }
  if (url.username || url.password || !url.hostname) return null;
  return url;
}
