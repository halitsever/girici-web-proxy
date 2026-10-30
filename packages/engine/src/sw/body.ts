export type BodyKind = "html" | "css" | "js";

const DOCUMENT_DESTINATIONS = new Set<string>(["document", "iframe", "frame", "object", "embed"]);

const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

interface Mime {
  essence: string;
  charset: string | null;
}

/** Fetch's "extract a MIME type": the last valid comma-separated piece wins, which is the type the browser renders. */
function extractMime(contentType: string | null): Mime | null {
  let found: Mime | null = null;
  let essence: string | null = null;
  let charset: string | null = null;
  for (const piece of (contentType ?? "").split(",")) {
    const [head = "", ...params] = piece.split(";");
    const [type, subtype, ...rest] = head.trim().toLowerCase().split("/");
    if (!type || !subtype || rest.length || !TOKEN.test(type) || !TOKEN.test(subtype)) continue;
    if (type === "*" && subtype === "*") continue;
    const own = charsetOf(params);
    if (`${type}/${subtype}` !== essence) {
      essence = `${type}/${subtype}`;
      charset = own;
    }
    // A repeat of the same type without a charset keeps the one named before it.
    found = { essence, charset: own ?? charset };
  }
  return found;
}

/** The first charset parameter, if it names an encoding the browser knows. */
function charsetOf(params: string[]): string | null {
  for (const param of params) {
    const at = param.indexOf("=");
    if (at < 0 || param.slice(0, at).trim().toLowerCase() !== "charset") continue;
    const value = param
      .slice(at + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .toLowerCase();
    if (!TOKEN.test(value)) return null;
    try {
      new TextDecoder(value);
    } catch {
      return null;
    }
    return value;
  }
  return null;
}

/** The essence of the type the browser would render, or null when it finds none. */
export function mimeOf(contentType: string | null): string | null {
  return extractMime(contentType)?.essence ?? null;
}

/** The one type sent with a document no rewriter touched; a text type keeps its charset so it still decodes right. */
export function contentTypeOf(contentType: string | null): string | null {
  const mime = extractMime(contentType);
  if (!mime) return null;
  return mime.charset && mime.essence.startsWith("text/") ? `${mime.essence}; charset=${mime.charset}` : mime.essence;
}

// What a browser sniffs an untyped body for: whitespace, then "<!doctype html" or "<html" ended by a space or ">".
const HTML_START = /^[\t\n\f\r ]*<(?:!doctype html|html)[ >]/i;
const SNIFF_BYTES = 1445;

/** True when an untyped body starts like HTML, which a browser would render as a page. */
export function sniffsHtml(bytes: ArrayBuffer): boolean {
  let head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, SNIFF_BYTES));
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) head = head.subarray(3);
  return HTML_START.test(new TextDecoder("latin1").decode(head));
}

/** Only bodies the browser will parse as a document, stylesheet or script need rewriting; fetch() data stays untouched. */
export function rewriteKind(
  destination: RequestDestination,
  navigation: boolean,
  contentType: string | null,
): BodyKind | null {
  const type = mimeOf(contentType) ?? "";
  if (isDocumentLoad(destination, navigation)) return type === "text/html" ? "html" : null;
  if (destination === "style") return type === "" || type.includes("css") ? "css" : null;
  if (destination === "script") return type === "" || /(?:java|ecma)script/.test(type) ? "js" : null;
  return null;
}

export function isDocumentLoad(destination: RequestDestination, navigation: boolean): boolean {
  return navigation || DOCUMENT_DESTINATIONS.has(destination);
}

/** Documents the browser runs on our origin that no rewriter touched, so they need a sandbox. PDFs and media keep their viewers. */
export function sandboxesDocument(
  destination: RequestDestination,
  navigation: boolean,
  contentType: string | null,
): boolean {
  if (!isDocumentLoad(destination, navigation)) return false;
  if (rewriteKind(destination, navigation, contentType)) return false;
  const type = mimeOf(contentType) ?? "";
  return !(type === "application/pdf" || type.startsWith("audio/") || type.startsWith("video/"));
}

const CHARSET = /charset\s*=\s*["']?([^"';\s>]+)/i;

export function decodeText(bytes: ArrayBuffer, contentType: string | null): string {
  const isHtml = mimeOf(contentType) === "text/html";
  const label = CHARSET.exec(contentType ?? "")?.[1] ?? (isHtml ? metaCharset(bytes) : undefined);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

/** Pages that name their encoding only in a <meta> tag must still decode right; full sniffing comes later. */
function metaCharset(bytes: ArrayBuffer): string | undefined {
  // The first 1024 bytes are read as Latin-1, which keeps the ASCII of the tag intact whatever the encoding.
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const label = CHARSET.exec(tag)?.[1];
    if (label) return label;
  }
  return undefined;
}
