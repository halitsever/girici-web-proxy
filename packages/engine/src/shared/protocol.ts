export const HEADER = {
  relay: "x-girici-relay",
  method: "x-girici-method",
  headers: "x-girici-headers",
  origin: "x-girici-origin",
  referer: "x-girici-referer",
  fetch: "x-girici-fetch",
  status: "x-girici-status",
  setCookie: "x-girici-set-cookie",
  error: "x-girici-error",
} as const;

export type RelayErrorCode =
  "bad_request" | "ssrf_blocked" | "dns" | "connect" | "tls" | "timeout" | "too_large" | "header_overflow";

/** base64url keeps any bytes, such as non-ASCII cookie values, legal inside an HTTP header. */
export function encodeHeaderValue(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeHeaderValue(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new TypeError("Header value is not base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeHeaderList(pairs: ReadonlyArray<readonly [string, string]>): string {
  return encodeHeaderValue(JSON.stringify(pairs));
}

export function decodeHeaderList(value: string): Array<[string, string]> {
  const parsed: unknown = JSON.parse(decodeHeaderValue(value));
  if (!Array.isArray(parsed) || !parsed.every(isPair)) throw new TypeError("Header list is malformed");
  return parsed;
}

function isPair(item: unknown): item is [string, string] {
  return Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string";
}
