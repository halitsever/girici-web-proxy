/** MIME and charset parsing shared by the service worker and the runtime, which both decode documents. */

const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

export interface Mime {
  essence: string;
  charset: string | null;
}

/** Fetch's "extract a MIME type": the last valid comma-separated piece wins, which is the type the browser renders. */
export function extractMime(contentType: string | null): Mime | null {
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
