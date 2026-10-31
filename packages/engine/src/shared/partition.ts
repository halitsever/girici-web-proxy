import {
  endsWith,
  indexOf,
  isWebUrl,
  originOf,
  parseUrl,
  protocolOf,
  sliceOf,
  startsWith,
  urlPart,
} from "./primordials.ts";

const PREFIX = "__g|";
const THIRD_PARTY = "__g^|";

/**
 * The key/name prefix that keeps one real origin's storage apart from another's on our shared origin. A frame of
 * another site stores under its top's origin too, so each site that embeds it sees its own copy.
 */
export function prefixFor(origin: string, top?: string): string {
  return top === undefined ? `${PREFIX}${origin}|` : `${THIRD_PARTY}${top}|${origin}|`;
}

/** The origin inside a partition name, or null for anything else, such as Girici's own stores. */
export function partitionOrigin(name: string): string | null {
  return parseName(name)?.origin ?? null;
}

/** The top origin of a third-party partition name ("null" when it was unknown); null for any other name. */
export function partitionTop(name: string): string | null {
  return parseName(name)?.top ?? null;
}

/** Same scheme, and the host is the site's host or one of its subdomains. */
export function sameSite(url: URL, site: string): boolean {
  const parsed = parseUrl(site);
  if (!parsed) return false;
  const host = urlPart(url, "hostname");
  const siteHost = urlPart(parsed, "hostname");
  return !!siteHost && protocolOf(url) === protocolOf(parsed) && (host === siteHost || endsWith(host, `.${siteHost}`));
}

function parseName(name: string): { origin: string; top: string | null } | null {
  if (startsWith(name, PREFIX)) {
    const origin = field(name, PREFIX.length);
    return origin && webOrigin(origin.value) ? { origin: origin.value, top: null } : null;
  }
  if (!startsWith(name, THIRD_PARTY)) return null;
  const top = field(name, THIRD_PARTY.length);
  const origin = top && field(name, top.end + 1);
  if (!top || !origin || !webOrigin(origin.value)) return null;
  return top.value === "null" || webOrigin(top.value) ? { origin: origin.value, top: top.value } : null;
}

function field(name: string, start: number): { value: string; end: number } | null {
  const end = indexOf(name, "|", start);
  return end === -1 ? null : { value: sliceOf(name, start, end), end };
}

function webOrigin(origin: string): boolean {
  const url = parseUrl(origin);
  return url !== null && isWebUrl(url) && originOf(url) === origin;
}
