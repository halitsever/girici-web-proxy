import { extractMime, mimeOf } from "../shared/charset.ts";

export { decodeText, mimeOf } from "../shared/charset.ts";

export type BodyKind = "html" | "css" | "js";

const DOCUMENT_DESTINATIONS = new Set<string>(["document", "iframe", "frame", "object", "embed"]);

/** The one type sent with a document no rewriter touched; a text type keeps its charset so it still decodes right. */
export function contentTypeOf(contentType: string | null): string | null {
  const mime = extractMime(contentType);
  if (!mime) return null;
  return mime.charset && mime.essence.startsWith("text/") ? `${mime.essence}; charset=${mime.charset}` : mime.essence;
}

// What a browser sniffs an untyped body for: whitespace, then "<!doctype html" or "<html" ended by a space or ">".
const HTML_START = /^[\t\n\f\r ]*<(?:!doctype html|html)[ >]/i;
export const SNIFF_BYTES = 1445;

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
