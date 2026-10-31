const PREFIX = "__g|";
const THIRD_PARTY = "__g^|";

// Taken at load: sameSite runs on page calls, after page code may have replaced URL getters or String methods.
const apply = Reflect.apply;
const NativeURL = URL;
const urlGetter = (name: string) => Object.getOwnPropertyDescriptor(URL.prototype, name)?.get as (this: URL) => string;
const protocolOf = urlGetter("protocol");
const hostnameOf = urlGetter("hostname");
const endsWith = String.prototype.endsWith;

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
  let parsed: URL;
  try {
    parsed = new NativeURL(site);
  } catch {
    return false;
  }
  const host = apply(hostnameOf, url, []);
  const siteHost = apply(hostnameOf, parsed, []);
  return (
    !!siteHost &&
    apply(protocolOf, url, []) === apply(protocolOf, parsed, []) &&
    (host === siteHost || (apply(endsWith, host, [`.${siteHost}`]) as boolean))
  );
}

function parseName(name: string): { origin: string; top: string | null } | null {
  if (name.startsWith(PREFIX)) {
    const origin = field(name, PREFIX.length);
    return origin && webOrigin(origin.value) ? { origin: origin.value, top: null } : null;
  }
  if (!name.startsWith(THIRD_PARTY)) return null;
  const top = field(name, THIRD_PARTY.length);
  const origin = top && field(name, top.end + 1);
  if (!top || !origin || !webOrigin(origin.value)) return null;
  return top.value === "null" || webOrigin(top.value) ? { origin: origin.value, top: top.value } : null;
}

function field(name: string, start: number): { value: string; end: number } | null {
  const end = name.indexOf("|", start);
  return end === -1 ? null : { value: name.slice(start, end), end };
}

function webOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin;
}
