import {
  append,
  endsWith,
  exec,
  indexOf,
  isNotANumber,
  lastIndexOf,
  lowerCase,
  parseDate,
  sliceOf,
  splitText,
  startsWith,
  toNumber,
  trim,
  urlPart,
} from "./primordials.ts";
import type { CookieSnapshot } from "./protocol.ts";

// Natives taken at load and indexed loops only: a window reused for another site keeps the runtime of the page that
// made it, so these run on that site's cookies in that page's realm, whose built-ins it may have replaced.

const MAX_AGE = /^-?\d+$/;

/** Parses a document.cookie assignment as browsers do for scripts; null when a script may not set it. */
export function parseScriptCookie(input: string, url: URL, now: number): CookieSnapshot | null {
  const parts = splitText(input, ";");
  const pair = parts[0] ?? "";
  const separator = indexOf(pair, "=");
  const name = separator < 0 ? "" : trim(sliceOf(pair, 0, separator));
  const value = trim(separator < 0 ? pair : sliceOf(pair, separator + 1));
  if (!name && !value) return null;

  const host = lowerCase(urlPart(url, "hostname"));
  let domain: string | null = null;
  let path = defaultPath(urlPart(url, "pathname"));
  let maxAge: number | null = null;
  let expires: number | null = null;
  let secure = false;
  for (let index = 1; index < parts.length; index++) {
    const attribute = parts[index] as string;
    const equals = indexOf(attribute, "=");
    const key = lowerCase(trim(equals < 0 ? attribute : sliceOf(attribute, 0, equals)));
    const raw = equals < 0 ? "" : trim(sliceOf(attribute, equals + 1));
    if (key === "httponly") return null;
    if (key === "secure") secure = true;
    else if (key === "path" && startsWith(raw, "/")) path = raw;
    else if (key === "domain" && raw) domain = lowerCase(startsWith(raw, ".") ? sliceOf(raw, 1) : raw);
    else if (key === "max-age" && exec(MAX_AGE, raw) !== null) maxAge = toNumber(raw);
    else if (key === "expires") {
      const time = parseDate(raw);
      if (!isNotANumber(time)) expires = time;
    }
  }
  if (domain !== null && !domainMatches(host, domain)) return null;
  if (secure && urlPart(url, "protocol") !== "https:") return null;
  if (maxAge !== null) expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  return {
    __proto__: null,
    name,
    value,
    domain: domain ?? host,
    path,
    hostOnly: domain === null,
    secure,
    expires,
    creation: now,
  } as CookieSnapshot;
}

/** Follows the RFC 6265 cookie-string order: longer paths first, then older cookies. */
export function cookieString(cookies: readonly CookieSnapshot[], url: URL, now: number): string {
  const host = lowerCase(urlPart(url, "hostname"));
  const pathname = urlPart(url, "pathname");
  const https = urlPart(url, "protocol") === "https:";
  const sorted: CookieSnapshot[] = [];
  for (let index = 0; index < cookies.length; index++) {
    const cookie = cookies[index] as CookieSnapshot;
    if (isExpired(cookie, now)) continue;
    if (cookie.hostOnly ? host !== cookie.domain : !domainMatches(host, cookie.domain)) continue;
    if (pathMatches(pathname, cookie.path) && (!cookie.secure || https)) insertSorted(sorted, cookie);
  }
  let text = "";
  for (let index = 0; index < sorted.length; index++) {
    const cookie = sorted[index] as CookieSnapshot;
    if (index > 0) text += "; ";
    text += cookie.name ? cookie.name + "=" + cookie.value : cookie.value;
  }
  return text;
}

export function applyCookieChanges(
  cookies: readonly CookieSnapshot[],
  changes: readonly CookieSnapshot[],
  now: number,
): CookieSnapshot[] {
  let next = cookies;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index] as CookieSnapshot;
    const kept: CookieSnapshot[] = [];
    for (let at = 0; at < next.length; at++) {
      const cookie = next[at] as CookieSnapshot;
      if (cookie.name !== change.name || cookie.domain !== change.domain || cookie.path !== change.path) {
        append(kept, cookie);
      }
    }
    append(kept, change);
    next = kept;
  }
  const live: CookieSnapshot[] = [];
  for (let index = 0; index < next.length; index++) {
    const cookie = next[index] as CookieSnapshot;
    if (!isExpired(cookie, now)) append(live, cookie);
  }
  return live;
}

export function domainMatches(host: string, domain: string): boolean {
  return host === domain || endsWith(host, "." + domain);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  const next = sliceOf(requestPath, cookiePath.length, cookiePath.length + 1);
  return startsWith(requestPath, cookiePath) && (endsWith(cookiePath, "/") || next === "/");
}

function defaultPath(pathname: string): string {
  const last = lastIndexOf(pathname, "/");
  return last <= 0 ? "/" : sliceOf(pathname, 0, last);
}

function isExpired(cookie: CookieSnapshot, now: number): boolean {
  return cookie.expires !== null && cookie.expires <= now;
}

/** A stable insertion sort; the list stays short and Array.prototype.sort is the page's. */
function insertSorted(list: CookieSnapshot[], cookie: CookieSnapshot): void {
  let at = list.length;
  while (at > 0 && comesBefore(cookie, list[at - 1] as CookieSnapshot)) at--;
  append(list, cookie);
  // Every index below length is an own property, so these writes reach no setter on Array.prototype.
  for (let index = list.length - 1; index > at; index--) list[index] = list[index - 1] as CookieSnapshot;
  list[at] = cookie;
}

function comesBefore(a: CookieSnapshot, b: CookieSnapshot): boolean {
  return (b.path.length - a.path.length || a.creation - b.creation) < 0;
}
