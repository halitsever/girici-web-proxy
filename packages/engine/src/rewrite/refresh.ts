import { decodeUrl, encodeUrl } from "../shared/codec.ts";
import { hrefOf, indexOf, isWebUrl, originOf, parseUrl, pathnameOf, searchOf, sliceOf } from "../shared/primordials.ts";
import { rewriteUrl } from "../shared/url-rewrite.ts";

const WHITESPACE: Record<string, true> = Object.assign(Object.create(null) as Record<string, true>, {
  "\t": true,
  "\n": true,
  "\f": true,
  "\r": true,
  " ": true,
});

export interface Refresh {
  /** Whole seconds as the browser reads them; a fraction is dropped. */
  time: string;
  /** The target as written, or null for a refresh of the page itself. */
  url: string | null;
}

/** The HTML standard's shared declarative refresh steps, through string indexing alone. Null where the browser stops. */
export function parseRefresh(input: string): Refresh | null {
  const length = input.length;
  let position = 0;
  const skipSpace = () => {
    while (position < length && WHITESPACE[input[position] as string]) position++;
  };
  const isDigit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";

  skipSpace();
  let time = "";
  while (isDigit(input[position])) time += input[position++];
  if (time === "" && input[position] !== ".") return null;
  while (isDigit(input[position]) || input[position] === ".") position++;
  time = time ? `${+time}` : "0";
  if (position < length) {
    const char = input[position] as string;
    if (char !== ";" && char !== "," && !WHITESPACE[char]) return null;
    skipSpace();
    if (input[position] === ";" || input[position] === ",") position++;
    skipSpace();
  }
  if (position >= length) return { time, url: null };

  let url = sliceOf(input, position);
  let prefixed = true;
  const take = (upper: string, lower: string) => {
    if (prefixed && (input[position] === upper || input[position] === lower)) position++;
    else prefixed = false;
  };
  if (input[position] === "U" || input[position] === "u") {
    position++;
    take("R", "r");
    take("L", "l");
    if (prefixed) {
      skipSpace();
      take("=", "=");
      skipSpace();
    }
  }
  // Without the full "url =" prefix the browser parses everything from the first character on.
  if (prefixed) {
    const char = input[position];
    const quote = char === "'" || char === '"' ? char : "";
    if (quote) position++;
    url = sliceOf(input, position);
    const end = quote ? indexOf(url, quote) : -1;
    if (end >= 0) url = sliceOf(url, 0, end);
  }
  return { time, url };
}

/**
 * Keeps a refresh only when the proxy can follow it: a refresh of the page itself, or one to a web URL, which is
 * proxied. Anything the parser cannot read, and blob:, javascript: or other targets, comes back empty, which the
 * browser ignores; a blob document would run without the runtime.
 */
export function rewriteRefresh(value: string, base: URL, origin: string): string {
  const refresh = parseRefresh(value);
  if (!refresh) return "";
  if (refresh.url === null) return value;
  const target = parseUrl(refresh.url, base);
  if (!target || !isWebUrl(target)) return "";
  // Written as an absolute proxy URL, never as the page's text: text that starts with a quote would be read again
  // by the browser's parser as a different target.
  const proxyBase = isWebUrl(base) ? parseUrl(encodeUrl(base), origin) : parseUrl(origin);
  const written = proxyBase ? parseUrl(rewriteUrl(refresh.url, base, origin), proxyBase) : null;
  if (!written || originOf(written) !== origin || !decodeUrl(pathnameOf(written) + searchOf(written))) return "";
  return `${refresh.time}; url=${hrefOf(written)}`;
}

/** Maps the URL of a refresh value; a value whose URL stays the same comes back exactly as written. */
export function mapRefresh(value: string, map: (url: string) => string): string {
  const refresh = parseRefresh(value);
  if (!refresh || refresh.url === null) return value;
  const mapped = map(refresh.url);
  return mapped === refresh.url ? value : `${refresh.time}; url=${mapped}`;
}
