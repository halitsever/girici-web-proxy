export interface SplitHeaders {
  native: Record<string, string | string[]>;
  envelope: Array<[string, string]>;
  setCookies: string[];
}

const DROPPED = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "strict-transport-security",
  "x-xss-protection",
  "alt-svc",
  "public-key-pins",
  "public-key-pins-report-only",
  "expect-ct",
  "report-to",
  "reporting-endpoints",
  "nel",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-embedder-policy-report-only",
  "cross-origin-resource-policy",
  // Preload and preconnect hints would make the browser contact the real site directly.
  "link",
  // These act on the whole proxy origin, so one site would impose them on every other.
  "clear-site-data",
  "accept-ch",
  "critical-ch",
  "origin-agent-cluster",
  "document-policy",
  "supports-loading-mode",
]);
const NATIVE = new Set([
  "content-type",
  "content-encoding",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
  "expires",
  "etag",
  "last-modified",
  "age",
  "date",
]);
const VARY_MAPPED: Record<string, string> = { cookie: "x-girici-cookie", origin: "x-girici-origin" };
const VARY_KEPT = new Set(["accept", "accept-language", "accept-encoding", "user-agent"]);

/** The envelope carries every header the page should see; native copies let the browser cache and range natively. */
export function splitUpstreamHeaders(headers: Record<string, string | string[] | undefined>): SplitHeaders {
  const split: SplitHeaders = { native: {}, envelope: [], setCookies: [] };
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    const values = Array.isArray(value) ? value : [value];
    if (name === "set-cookie") {
      split.setCookies.push(...values);
      continue;
    }
    if (DROPPED.has(name) || name.startsWith("access-control-")) continue;
    for (const item of values) split.envelope.push([name, item]);
    if (NATIVE.has(name)) split.native[name] = value;
    if (name === "vary") split.native.vary = mapVary(values.join(", "));
  }
  // Keeps caches from answering a request without the relay marker, such as a direct visit, with a relay response.
  split.native.vary ??= mapVary(undefined);
  return split;
}

/** The browser cache keys relay responses by relay request headers, so upstream Vary names are translated. */
export function mapVary(value: string | undefined): string {
  const tokens = ["x-girici-relay"];
  for (const raw of (value ?? "").split(",")) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (token === "*") return "*";
    const mapped = VARY_MAPPED[token] ?? (VARY_KEPT.has(token) ? token : "x-girici-headers");
    if (!tokens.includes(mapped)) tokens.push(mapped);
  }
  return tokens.join(", ");
}
