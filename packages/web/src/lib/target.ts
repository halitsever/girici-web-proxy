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
