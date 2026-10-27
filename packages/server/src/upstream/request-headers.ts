import type { IncomingHttpHeaders } from "node:http";
import { decodeHeaderList, decodeHeaderValue, HEADER } from "@girici/engine/shared";
import { RelayRequestError } from "./errors.ts";

const NATIVE_ALLOWLIST = new Set([
  "user-agent",
  "accept",
  "accept-language",
  "range",
  "content-type",
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "if-range",
  "cache-control",
  "pragma",
]);
const ACCEPTED_ENCODINGS = new Set(["gzip", "deflate", "br", "zstd"]);
const FORBIDDEN = new Set([
  "host",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "cookie",
  "cookie2",
  "origin",
  "referer",
  "accept-encoding",
  "expect",
  "via",
  "forwarded",
]);
const FORBIDDEN_PREFIXES = ["proxy-", "sec-fetch-", "x-girici-", "x-forwarded-"];
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
const FETCH_FIELD = /^[a-z-]+$/;

/** Builds the upstream request from the browser's own headers plus what the page set, never from our cookies. */
export function buildUpstreamHeaders(relayHeaders: IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(relayHeaders)) {
    if (typeof value === "string" && (NATIVE_ALLOWLIST.has(name) || name.startsWith("sec-ch-"))) headers[name] = value;
  }
  const encodings = acceptedEncodings(relayHeaders["accept-encoding"]);
  if (encodings) headers["accept-encoding"] = encodings;

  for (const [rawName, value] of decodeEnvelope(relayHeaders[HEADER.headers])) {
    const name = rawName.toLowerCase();
    // undici throws on invalid names or values, which would surface as a confusing 502.
    if (!HEADER_NAME.test(name) || /[\r\n\0]/.test(value)) continue;
    if (FORBIDDEN.has(name) || FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers[name] = value;
  }

  const cookie = decodeOptional(relayHeaders[HEADER.cookie]);
  if (cookie) {
    // The jar's value goes out as a raw header line, so a line break would smuggle in headers of its own.
    if (/[\r\n\0]/.test(cookie)) throw new RelayRequestError("bad_request", 400);
    headers.cookie = cookie;
  }

  const origin = decodeOptional(relayHeaders[HEADER.origin]);
  if (origin) headers.origin = origin;
  const referer = decodeOptional(relayHeaders[HEADER.referer]);
  if (referer) headers.referer = referer;
  return { ...headers, ...fetchMetadata(decodeOptional(relayHeaders[HEADER.fetch])) };
}

function acceptedEncodings(value: string | undefined): string | undefined {
  const tokens = (value ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .filter((token) => ACCEPTED_ENCODINGS.has(token));
  return tokens.length > 0 ? tokens.join(", ") : undefined;
}

function decodeEnvelope(value: string | string[] | undefined): Array<[string, string]> {
  if (typeof value !== "string") return [];
  try {
    return decodeHeaderList(value);
  } catch {
    throw new RelayRequestError("bad_request", 400);
  }
}

function decodeOptional(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return decodeHeaderValue(value);
  } catch {
    throw new RelayRequestError("bad_request", 400);
  }
}

function fetchMetadata(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const [dest, mode, site, user] = value.split(";");
  if (!dest || !mode || !site || ![dest, mode, site].every((field) => FETCH_FIELD.test(field))) return {};
  const metadata: Record<string, string> = { "sec-fetch-dest": dest, "sec-fetch-mode": mode, "sec-fetch-site": site };
  if (user === "?1") metadata["sec-fetch-user"] = "?1";
  return metadata;
}
