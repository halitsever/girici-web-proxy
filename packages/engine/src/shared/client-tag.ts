import type { ClientConfig } from "./protocol.ts";

// Taken at load: the runtime builds tags inside page calls, after page code may have replaced these.
const stringify = JSON.stringify;
const keysOf = Object.keys;
const isArray = Array.isArray;
const ESCAPES = Object.assign(Object.create(null) as Record<string, string>, {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
});

/** The runtime reads its config from this attribute, before any page script can run. */
export function clientTag(src: string, config: ClientConfig): string {
  return `<script src="${src}" data-girici="${escapeAttribute(encode(config) ?? "null")}"></script>`;
}

/** Takes the runtime tag back out of a srcdoc the page reads, so it sees the markup it wrote. */
export function stripClientTag(markup: string, clientUrl: string): string {
  const open = `<script src="${clientUrl}" data-girici="`;
  const start = markup.indexOf(open);
  if (start < 0) return markup;
  const end = markup.indexOf('"></script>', start + open.length);
  return end < 0 ? markup : markup.slice(0, start) + markup.slice(end + '"></script>'.length);
}

/**
 * JSON from own properties, so a toJSON the page put on a prototype is never consulted. Only primitives reach the
 * captured stringify, which looks up toJSON on objects alone.
 */
function encode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return stringify(value) as string | undefined;
  if (isArray(value)) {
    let out = "[";
    for (let index = 0; index < value.length; index++) out += (index ? "," : "") + (encode(value[index]) ?? "null");
    return out + "]";
  }
  const keys = keysOf(value);
  let out = "{";
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const item = encode((value as Record<string, unknown>)[key]);
    if (item !== undefined) out += (out === "{" ? "" : ",") + stringify(key) + ":" + item;
  }
  return out + "}";
}

/** For a double- or single-quoted HTML attribute value; the server's and the worker's form pages use it too. */
export function escapeAttribute(text: string): string {
  let escaped = "";
  for (let index = 0; index < text.length; index++) escaped += ESCAPES[text[index]!] ?? text[index];
  return escaped;
}
