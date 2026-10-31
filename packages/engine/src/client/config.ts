import { append, isArray, ownValue, parseJson } from "../shared/primordials.ts";
import { PROTOCOL_VERSION, type ClientConfig, type CookieSnapshot, type InheritedContext } from "../shared/protocol.ts";

export function readConfig(raw: string | null): ClientConfig {
  // A missing or broken config leaves the page with an empty cookie mirror.
  return parseConfig(raw) ?? ({ __proto__: null, v: PROTOCOL_VERSION, cookies: [] } as ClientConfig);
}

/**
 * The config as written, or null when it is missing or broken. Renewal parses on page calls of another realm, so only
 * natives taken at load and own fields count, and every object comes back with a null prototype.
 */
export function parseConfig(raw: string | null): ClientConfig | null {
  let parsed: unknown;
  try {
    parsed = parseJson(raw ?? "");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = ownValue(parsed, "v");
  const cookies = readCookies(ownValue(parsed, "cookies"));
  if (typeof v !== "number" || !cookies) return null;
  const config = { __proto__: null, v, cookies } as ClientConfig;
  const inherit = readInherited(ownValue(parsed, "inherit"));
  if (inherit) config.inherit = inherit;
  const site = ownValue(parsed, "site");
  if (typeof site === "string") config.site = site;
  const blocked = ownValue(parsed, "cookiesBlocked");
  if (typeof blocked === "boolean") config.cookiesBlocked = blocked;
  return config;
}

/** Cookie snapshots from a config or the worker; null unless `value` is an array. Malformed entries are dropped. */
export function readCookies(value: unknown): CookieSnapshot[] | null {
  if (!isArray(value)) return null;
  const cookies: CookieSnapshot[] = [];
  for (let index = 0; index < value.length; index++) {
    const cookie = readCookie(ownValue(value, index));
    if (cookie) append(cookies, cookie);
  }
  return cookies;
}

function readCookie(item: unknown): CookieSnapshot | null {
  if (typeof item !== "object" || item === null) return null;
  const name = ownValue(item, "name");
  const value = ownValue(item, "value");
  const domain = ownValue(item, "domain");
  const path = ownValue(item, "path");
  const hostOnly = ownValue(item, "hostOnly");
  const secure = ownValue(item, "secure");
  const expires = ownValue(item, "expires");
  const creation = ownValue(item, "creation");
  if (typeof name !== "string" || typeof value !== "string" || typeof domain !== "string") return null;
  if (typeof path !== "string" || typeof hostOnly !== "boolean" || typeof secure !== "boolean") return null;
  if ((expires !== null && typeof expires !== "number") || typeof creation !== "number") return null;
  return { __proto__: null, name, value, domain, path, hostOnly, secure, expires, creation } as CookieSnapshot;
}

function readInherited(value: unknown): InheritedContext | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const origin = ownValue(value, "origin");
  const base = ownValue(value, "base");
  if (typeof origin !== "string" || typeof base !== "string") return undefined;
  const inherit = { __proto__: null, origin, base } as InheritedContext;
  const blob = ownValue(value, "blob");
  if (typeof blob === "string") inherit.blob = blob;
  return inherit;
}
