import { decodeUrl, encodeUrl, isReservedPath } from "./codec.ts";
import {
  codePointAt,
  endsWith,
  exec,
  hashOf,
  hrefOf,
  includes,
  isWebUrl as isWeb,
  lowerCase,
  newBytes,
  newUrl,
  originOf,
  parseHex,
  parseJson,
  parseUrl as parse,
  pathnameOf,
  protocolOf,
  quoteJson,
  replaceAll,
  searchOf,
  setUrlPart,
  sliceOf,
  startsWith,
  trim,
  utf8Text,
} from "./primordials.ts";
import { isSealedPath, type OpenSealed } from "./sealed-address.ts";

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
const PERCENT = /%/g;
const escapedPercent = () => "%25";

/**
 * Rewrites a URL found in a page so that requests and navigations stay on the proxy. `owner` is the real origin of the
 * document the URL belongs to, which a javascript: URL carries; it defaults to the base's. In an `opaque` document,
 * one on a sealed address, the browser cannot resolve relative URLs, so they are written absolute; hash and query links
 * stay relative and keep the page.
 */
export function rewriteUrl(raw: string, base: URL, origin: string, owner?: string, opaque = false): string {
  const script = rewriteJavascriptUrl(raw, owner ?? (isWeb(base) ? originOf(base) : "null"));
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
  if (opaque && startsWith(value, "?")) return raw;

  if (startsWith(value, "/") && !startsWith(value, "//")) {
    const own = parse(value, origin);
    if (own && decodeUrl(pathnameOf(own) + searchOf(own))) return raw;
  }

  // The URL parser drops tabs and newlines, so "java\nscript:" only shows its scheme once resolved.
  const real = parse(value, base);
  if (!real || !isWeb(real)) return raw;
  if (!opaque && !startsWith(value, "/") && resolvesInsideProxy(value, real, base, origin)) return raw;
  return encodeUrl(real);
}

/** Parsed as the browser would, so " BLOB:" and "bl\nob:" count too. */
export function isBlobUrl(value: string): boolean {
  const url = parse(value);
  return url !== null && protocolOf(url) === "blob:";
}

/** Turns a URL the browser resolved against a proxy URL back into the URL the page meant; `open` reads sealed ones. */
export function unrewriteUrl(value: string, base: URL, origin: string, open?: OpenSealed): string {
  const wrapped = wrappedJavascript(value);
  if (wrapped !== null) return `javascript:${wrapped.code}`;
  if (!isWeb(base)) return value;
  // blob:, data: and other non-web schemes are the page's own and never one of our proxy URLs.
  const scheme = exec(SCHEME, value)?.[0];
  const lower = scheme ? lowerCase(scheme) : "";
  if (lower && lower !== "http:" && lower !== "https:") return value;
  const url = parse(value, newUrl(encodeUrl(base), origin));
  if (!url || originOf(url) !== origin) return value;
  const path = pathnameOf(url) + searchOf(url);
  const real = (open && isSealedPath(path) ? open(path) : null) ?? decodeUrl(path);
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
 * window without the runtime has no helper, so its navigation fails. The helper runs the code only when `owner`, the
 * real origin of the document that wrote the URL, is the window's own, as a browser would. Null for any other URL.
 */
export function rewriteJavascriptUrl(raw: string, owner: string): string | null {
  const value = replaceAll(replaceAll(raw, URL_EDGES, none), TAB_OR_NEWLINE, none);
  if (!exec(JAVASCRIPT, value)) return null;
  // Only an exact call with this owner is left alone: anything after it would run unwrapped, and another owner may
  // have been written by the page to borrow a different origin.
  if (wrappedJavascript(value)?.owner === owner) return value;
  const code = percentDecode(sliceOf(value, "javascript:".length));
  // The browser percent-decodes the URL before running it, so a % in the literal is escaped once more.
  const call = `${quoteJson(code)},${quoteJson(owner)}`;
  return `${HELPER_CALL}${replaceAll(call, PERCENT, escapedPercent)})`;
}

/** The page's code and its owner inside a URL this module wrapped, or null. */
function wrappedJavascript(value: string): { code: string; owner: string } | null {
  if (!startsWith(value, HELPER_CALL) || !endsWith(value, ")")) return null;
  try {
    const args = parseJson(`[${percentDecode(sliceOf(value, HELPER_CALL.length, -1))}]`) as unknown[];
    const code = args[0];
    const owner = args[1];
    return args.length === 2 && typeof code === "string" && typeof owner === "string" ? { code, owner } : null;
  } catch {
    return null;
  }
}

/** The URL standard's percent-decode: valid escapes become UTF-8 bytes, anything else stays as written. */
function percentDecode(text: string): string {
  if (!includes(text, "%")) return text;
  // A UTF-16 unit never takes more than three UTF-8 bytes.
  const bytes = newBytes(text.length * 3);
  let length = 0;
  for (let index = 0; index < text.length;) {
    if (exec(PERCENT_BYTE, sliceOf(text, index, index + 3))) {
      bytes[length++] = parseHex(sliceOf(text, index + 1, index + 3));
      index += 3;
      continue;
    }
    let point = codePointAt(text, index) ?? 0;
    index += point > 0xffff ? 2 : 1;
    // A lone surrogate encodes as U+FFFD, as TextEncoder does.
    if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
    length = putUtf8(bytes, length, point);
  }
  return utf8Text(bytes, length);
}

function putUtf8(bytes: Uint8Array, at: number, point: number): number {
  if (point < 0x80) {
    bytes[at] = point;
    return at + 1;
  }
  if (point < 0x800) {
    bytes[at] = 0xc0 | (point >> 6);
    bytes[at + 1] = 0x80 | (point & 0x3f);
    return at + 2;
  }
  if (point < 0x10000) {
    bytes[at] = 0xe0 | (point >> 12);
    bytes[at + 1] = 0x80 | ((point >> 6) & 0x3f);
    bytes[at + 2] = 0x80 | (point & 0x3f);
    return at + 3;
  }
  bytes[at] = 0xf0 | (point >> 18);
  bytes[at + 1] = 0x80 | ((point >> 12) & 0x3f);
  bytes[at + 2] = 0x80 | ((point >> 6) & 0x3f);
  bytes[at + 3] = 0x80 | (point & 0x3f);
  return at + 4;
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
