import type { CookieSnapshot } from "./protocol.ts";

/** Parses a document.cookie assignment as browsers do for scripts; null when a script may not set it. */
export function parseScriptCookie(input: string, url: URL, now: number): CookieSnapshot | null {
  // Indexed, without destructuring: this runs on the page's cookie writes, after the page may have replaced the
  // array iterator.
  const parts = input.split(";");
  const pair = parts[0] ?? "";
  const separator = pair.indexOf("=");
  const name = separator < 0 ? "" : pair.slice(0, separator).trim();
  const value = (separator < 0 ? pair : pair.slice(separator + 1)).trim();
  if (!name && !value) return null;

  const host = url.hostname.toLowerCase();
  let domain: string | null = null;
  let path = defaultPath(url.pathname);
  let maxAge: number | null = null;
  let expires: number | null = null;
  let secure = false;
  for (let index = 1; index < parts.length; index++) {
    const attribute = parts[index] as string;
    const equals = attribute.indexOf("=");
    const key = (equals < 0 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    const raw = equals < 0 ? "" : attribute.slice(equals + 1).trim();
    if (key === "httponly") return null;
    if (key === "secure") secure = true;
    else if (key === "path" && raw.startsWith("/")) path = raw;
    else if (key === "domain" && raw) domain = raw.replace(/^\./, "").toLowerCase();
    else if (key === "max-age" && /^-?\d+$/.test(raw)) maxAge = Number(raw);
    else if (key === "expires") {
      const time = Date.parse(raw);
      if (!Number.isNaN(time)) expires = time;
    }
  }
  if (domain !== null && !domainMatches(host, domain)) return null;
  if (secure && url.protocol !== "https:") return null;
  if (maxAge !== null) expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  return { name, value, domain: domain ?? host, path, hostOnly: domain === null, secure, expires, creation: now };
}

/** Follows the RFC 6265 cookie-string order: longer paths first, then older cookies. */
export function cookieString(cookies: CookieSnapshot[], url: URL, now: number): string {
  const host = url.hostname.toLowerCase();
  return cookies
    .filter(
      (cookie) =>
        !isExpired(cookie, now) &&
        (cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain)) &&
        pathMatches(url.pathname, cookie.path) &&
        (!cookie.secure || url.protocol === "https:"),
    )
    .sort((a, b) => b.path.length - a.path.length || a.creation - b.creation)
    .map((cookie) => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))
    .join("; ");
}

export function applyCookieChanges(
  cookies: CookieSnapshot[],
  changes: CookieSnapshot[],
  now: number,
): CookieSnapshot[] {
  let next = cookies;
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index] as CookieSnapshot;
    next = next.filter(
      (cookie) => !(cookie.name === change.name && cookie.domain === change.domain && cookie.path === change.path),
    );
    next.push(change);
  }
  return next.filter((cookie) => !isExpired(cookie, now));
}

export function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  return (
    requestPath.startsWith(cookiePath) && (cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/")
  );
}

function defaultPath(pathname: string): string {
  const last = pathname.lastIndexOf("/");
  return last <= 0 ? "/" : pathname.slice(0, last);
}

function isExpired(cookie: CookieSnapshot, now: number): boolean {
  return cookie.expires !== null && cookie.expires <= now;
}
