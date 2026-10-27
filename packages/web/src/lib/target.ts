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
