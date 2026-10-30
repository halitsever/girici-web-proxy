export type BodyKind = "html" | "css" | "js";

const DOCUMENT_DESTINATIONS = new Set<string>(["document", "iframe", "frame", "object", "embed"]);

const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/** Fetch's "extract a MIME type": the last valid comma-separated piece wins, which is the type the browser renders. */
export function mimeOf(contentType: string | null): string | null {
  let essence: string | null = null;
  for (const piece of (contentType ?? "").split(",")) {
    const [type, subtype, ...rest] = (piece.split(";")[0] ?? "").trim().toLowerCase().split("/");
    if (!type || !subtype || rest.length || !TOKEN.test(type) || !TOKEN.test(subtype)) continue;
    if (type === "*" && subtype === "*") continue;
    essence = `${type}/${subtype}`;
  }
  return essence;
}

/** Only bodies the browser will parse as a document, stylesheet or script need rewriting; fetch() data stays untouched. */
export function rewriteKind(
  destination: RequestDestination,
  navigation: boolean,
  contentType: string | null,
): BodyKind | null {
  const type = mimeOf(contentType) ?? "";
  if (navigation || DOCUMENT_DESTINATIONS.has(destination)) return type === "text/html" ? "html" : null;
  if (destination === "style") return type === "" || type.includes("css") ? "css" : null;
  if (destination === "script") return type === "" || /(?:java|ecma)script/.test(type) ? "js" : null;
  return null;
}

/** Documents the browser runs on our origin that no rewriter touched, so they need a sandbox. PDFs and media keep their viewers. */
export function sandboxesDocument(
  destination: RequestDestination,
  navigation: boolean,
  contentType: string | null,
): boolean {
  if (!navigation && !DOCUMENT_DESTINATIONS.has(destination)) return false;
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
