import { decodeUrl, encodeUrl, isReservedPath } from "./codec.ts";
import {
  endsWith,
  exec,
  hashOf,
  hrefOf,
  isWebUrl as isWeb,
  lowerCase,
  newUrl,
  originOf,
  parseUrl as parse,
  pathnameOf,
  replaceAll,
  searchOf,
  setUrlPart,
  sliceOf,
  startsWith,
  trim,
} from "./primordials.ts";

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const EDGE_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const URL_EDGES = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
const TAB_OR_NEWLINE = /[\t\n\r]/g;
const JAVASCRIPT = /^javascript:/i;
const HELPER_CALL = "javascript:__g$.J(";
const PERCENT_BYTE = /^%[\da-f]{2}/i;
const TRAILING_COMMAS = /,+$/g;
const INNER_WHITESPACE = /[\t\n\f\r ]+/g;
const none = () => "";
const space = () => " ";

/** Rewrites a URL found in a page so that requests and navigations stay on the proxy. */
export function rewriteUrl(raw: string, base: URL, origin: string): string {
  const script = rewriteJavascriptUrl(raw);
  if (script !== null) return script;
  // Browsers ignore ASCII whitespace around URL attributes.
  const value = replaceAll(raw, EDGE_WHITESPACE, none);
  if (!value || startsWith(value, "#")) return raw;

  const scheme = exec(SCHEME, value)?.[0];
  if (scheme) {
    const lower = lowerCase(scheme);
    if (lower !== "http:" && lower !== "https:") return raw;
    const absolute = parse(value);
    if (!absolute) return raw;
    if (originOf(absolute) !== origin) return encodeUrl(absolute);
    return isWeb(base) ? ownUrl(absolute, base, raw) : raw;
  }
  // Against a base such as about:blank, relative URLs have no web target to proxy.
  if (!isWeb(base)) return raw;

  if (startsWith(value, "/") && !startsWith(value, "//")) {
    const own = parse(value, origin);
    if (own && decodeUrl(pathnameOf(own) + searchOf(own))) return raw;
  }

  // The URL parser drops tabs and newlines, so "java\nscript:" only shows its scheme once resolved.
  const real = parse(value, base);
  if (!real || !isWeb(real)) return raw;
  if (!startsWith(value, "/") && resolvesInsideProxy(value, real, base, origin)) return raw;
  return encodeUrl(real);
}

/** Turns a URL the browser resolved against a proxy URL back into the URL the page meant. */
export function unrewriteUrl(value: string, base: URL, origin: string): string {
  const code = wrappedJavascript(value);
  if (code !== null) return `javascript:${code}`;
  if (!isWeb(base)) return value;
  // blob:, data: and other non-web schemes are the page's own and never one of our proxy URLs.
  const scheme = exec(SCHEME, value)?.[0];
  const lower = scheme ? lowerCase(scheme) : "";
  if (lower && lower !== "http:" && lower !== "https:") return value;
  const url = parse(value, newUrl(encodeUrl(base), origin));
  if (!url || originOf(url) !== origin) return value;
  const real = decodeUrl(pathnameOf(url) + searchOf(url));
  if (real) {
    setUrlPart(real, "hash", hashOf(url));
    return hrefOf(real);
  }
  if (isReservedPath(pathnameOf(url))) return value;
  return hrefOf(newUrl(pathnameOf(url) + searchOf(url) + hashOf(url), originOf(base)));
}

/**
 * A javascript: URL runs in the window it navigates, and a string result becomes that window's new document. The code
 * goes to the window's runtime helper, which rewrites it and puts the runtime in front of any document it makes; a
 * window without the runtime has no helper, so its navigation fails. Null for any other URL.
 */
export function rewriteJavascriptUrl(raw: string): string | null {
  const value = raw.replace(URL_EDGES, "").replace(TAB_OR_NEWLINE, "");
  if (!JAVASCRIPT.test(value)) return null;
  // Only an exact call with one string literal is left alone; anything after it would run unwrapped.
  if (wrappedJavascript(value) !== null) return value;
  const code = percentDecode(value.slice("javascript:".length));
  // The browser percent-decodes the URL before running it, so a % in the literal is escaped once more.
  return `${HELPER_CALL}${JSON.stringify(code).replace(/%/g, "%25")})`;
}

/** The page's code inside a URL this module wrapped, or null. */
function wrappedJavascript(value: string): string | null {
  if (!value.startsWith(HELPER_CALL) || !value.endsWith(")")) return null;
  try {
    const code: unknown = JSON.parse(percentDecode(value.slice(HELPER_CALL.length, -1)));
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/** The URL standard's percent-decode: valid escapes become UTF-8 bytes, anything else stays as written. */
function percentDecode(text: string): string {
  if (!text.includes("%")) return text;
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let index = 0; index < text.length;) {
    if (PERCENT_BYTE.test(text.slice(index, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 3;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(index) ?? 0);
    for (const byte of encoder.encode(char)) bytes.push(byte);
    index += char.length;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Follows the HTML srcset parsing rules, so URLs that contain commas survive. */
export function rewriteSrcset(value: string, rewrite: (url: string) => string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    while (index < value.length && (isWhitespace(value[index]) || value[index] === ",")) index++;
    if (index >= value.length) break;

    const start = index;
    while (index < value.length && !isWhitespace(value[index])) index++;
    let url = sliceOf(value, start, index);
    let descriptors = "";
    if (endsWith(url, ",")) {
      url = replaceAll(url, TRAILING_COMMAS, none);
    } else {
      const descriptorStart = index;
      let depth = 0;
      while (index < value.length) {
        const char = value[index];
        if (char === "(") depth++;
        else if (char === ")") depth = depth > 0 ? depth - 1 : 0;
        else if (char === "," && depth === 0) break;
        index++;
      }
      descriptors = replaceAll(trim(sliceOf(value, descriptorStart, index)), INNER_WHITESPACE, space);
    }
    if (url) result += (result ? ", " : "") + (descriptors ? `${rewrite(url)} ${descriptors}` : rewrite(url));
  }
  return result;
}

/** Only proxy URLs stay on our origin; naming our UI, engine or admin paths from a page reaches the page's site. */
function ownUrl(url: URL, base: URL, raw: string): string {
  if (decodeUrl(pathnameOf(url) + searchOf(url))) return raw;
  return encodeUrl(newUrl(pathnameOf(url) + searchOf(url) + hashOf(url), originOf(base)));
}

/** Too many "../" segments would climb out of the proxy prefix, so such URLs are rewritten too. */
function resolvesInsideProxy(value: string, real: URL, base: URL, origin: string): boolean {
  const viaProxy = parse(value, newUrl(encodeUrl(base), origin));
  if (!viaProxy || originOf(viaProxy) !== origin) return false;
  const decoded = decodeUrl(pathnameOf(viaProxy) + searchOf(viaProxy));
  if (!decoded) return false;
  setUrlPart(decoded, "hash", hashOf(viaProxy));
  return hrefOf(decoded) === hrefOf(real);
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
}
