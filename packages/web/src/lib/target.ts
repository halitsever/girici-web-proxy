import { encodeUrl } from "@girici/engine/shared";

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/** Turns what the user typed into the proxy path for that page, or null when it is not a public http(s) URL. */
export function toProxyPath(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    // Safari 17.4, which we support, has no URL.parse.
    url = new URL(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // Single-label hosts such as "localhost" or a stray word are not public sites.
  if (!url.hostname.startsWith("[") && !url.hostname.includes(".")) return null;

  return encodeUrl(url);
}

/** DuckDuckGo's HTML version works without JavaScript, which suits a proxy best. */
export function toSearchPath(query: string): string {
  return encodeUrl(new URL(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.trim())}`));
}

/** Text that is not a URL is searched for; something that looks like a URL but is not a usable one is refused. */
export function resolveInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return toProxyPath(trimmed) ?? (SCHEME.test(trimmed) ? null : toSearchPath(trimmed));
}

/** The JavaScript-free query endpoints the palette can route searches through. */
export const SEARCH_ENGINES = {
  DuckDuckGo: "https://html.duckduckgo.com/html/?q=",
  Google: "https://www.google.com/search?q=",
  Bing: "https://www.bing.com/search?q=",
} as const;

export type SearchEngine = keyof typeof SEARCH_ENGINES;

/** Build the proxy path for a search on the chosen engine. */
export function searchPath(query: string, engine: SearchEngine): string {
  return encodeUrl(new URL(`${SEARCH_ENGINES[engine]}${encodeURIComponent(query.trim())}`));
}

export type Resolution =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "url"; path: string; display: string }
  | { kind: "search"; path: string; engine: SearchEngine };

/** Classify what the user typed for the command palette: empty, a search, a usable URL, or an invalid one. */
export function classifyInput(input: string, engine: SearchEngine): Resolution {
  const trimmed = input.trim();
  if (!trimmed) return { kind: "empty" };
  // A query with spaces or no dot is a search, never a URL.
  if (/\s/.test(trimmed) || !trimmed.includes(".")) {
    return { kind: "search", path: searchPath(trimmed, engine), engine };
  }
  const path = toProxyPath(trimmed);
  if (!path) return { kind: "invalid" };
  return { kind: "url", path, display: SCHEME.test(trimmed) ? trimmed : `https://${trimmed}` };
}
