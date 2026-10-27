import { decodeUrl, encodeUrl, isReservedPath } from "./codec.ts";

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const EDGE_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** Rewrites a URL found in a page so that requests and navigations stay on the proxy. */
export function rewriteUrl(raw: string, base: URL, origin: string): string {
  // Browsers ignore ASCII whitespace around URL attributes.
  const value = raw.replace(EDGE_WHITESPACE, "");
  if (!value || value.startsWith("#")) return raw;

  const scheme = SCHEME.exec(value)?.[0].toLowerCase();
  if (scheme) {
    if (scheme !== "http:" && scheme !== "https:") return raw;
    const absolute = parse(value);
    if (!absolute) return raw;
    if (absolute.origin !== origin) return encodeUrl(absolute);
    return isWeb(base) ? ownUrl(absolute, base, raw) : raw;
  }
  // Against a base such as about:blank, relative URLs have no web target to proxy.
  if (!isWeb(base)) return raw;

  if (value.startsWith("/") && !value.startsWith("//")) {
    const own = parse(value, origin);
    if (own && decodeUrl(own.pathname + own.search)) return raw;
  }

  // The URL parser drops tabs and newlines, so "java\nscript:" only shows its scheme once resolved.
  const real = parse(value, base);
  if (!real || !isWeb(real)) return raw;
  if (!value.startsWith("/") && resolvesInsideProxy(value, real, base, origin)) return raw;
  return encodeUrl(real);
}

/** Turns a URL the browser resolved against a proxy URL back into the URL the page meant. */
export function unrewriteUrl(value: string, base: URL, origin: string): string {
  if (!isWeb(base)) return value;
  // blob:, data: and other non-web schemes are the page's own and never one of our proxy URLs.
  const scheme = SCHEME.exec(value)?.[0].toLowerCase();
  if (scheme && scheme !== "http:" && scheme !== "https:") return value;
  const url = parse(value, new URL(encodeUrl(base), origin));
  if (!url || url.origin !== origin) return value;
  const real = decodeUrl(url.pathname + url.search);
  if (real) {
    real.hash = url.hash;
    return real.href;
  }
  if (isReservedPath(url.pathname)) return value;
  return new URL(url.pathname + url.search + url.hash, base.origin).href;
}

/** Follows the HTML srcset parsing rules, so URLs that contain commas survive. */
export function rewriteSrcset(value: string, rewrite: (url: string) => string): string {
  const candidates: string[] = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && (isWhitespace(value[index]) || value[index] === ",")) index++;
    if (index >= value.length) break;

    const start = index;
    while (index < value.length && !isWhitespace(value[index])) index++;
    let url = value.slice(start, index);
    let descriptors = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      const descriptorStart = index;
      let depth = 0;
      while (index < value.length) {
        const char = value[index];
        if (char === "(") depth++;
        else if (char === ")") depth = Math.max(0, depth - 1);
        else if (char === "," && depth === 0) break;
        index++;
      }
      descriptors = value
        .slice(descriptorStart, index)
        .trim()
        .replace(/[\t\n\f\r ]+/g, " ");
    }
    if (url) candidates.push(descriptors ? `${rewrite(url)} ${descriptors}` : rewrite(url));
  }
  return candidates.join(", ");
}

/** Our origin also serves the UI and the engine; other paths there were root-relative URLs of the page. */
function ownUrl(url: URL, base: URL, raw: string): string {
  if (decodeUrl(url.pathname + url.search) || isReservedPath(url.pathname)) return raw;
  return encodeUrl(new URL(url.pathname + url.search + url.hash, base.origin));
}

/** Too many "../" segments would climb out of the proxy prefix, so such URLs are rewritten too. */
function resolvesInsideProxy(value: string, real: URL, base: URL, origin: string): boolean {
  const viaProxy = parse(value, new URL(encodeUrl(base), origin));
  if (!viaProxy || viaProxy.origin !== origin) return false;
  const decoded = decodeUrl(viaProxy.pathname + viaProxy.search);
  if (!decoded) return false;
  decoded.hash = viaProxy.hash;
  return decoded.href === real.href;
}

function parse(value: string, base?: string | URL): URL | null {
  try {
    // Safari 17.4, which the engine supports, has no URL.parse.
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isWeb(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
}
