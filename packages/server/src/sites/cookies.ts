import { readSitePrefs, type SiteDomain, type SitePrefs } from "@girici/engine/shared";
import { cookieValues } from "../http/cookie-values.ts";
import type { SiteKeys } from "./keys.ts";
import { openValue, signedLength, signValue } from "./signed.ts";

/** The UI's engine settings, readable by every site host's config route. */
export const PREFS_COOKIE = "__Secure-girici-prefs";
export const PLAIN_PREFS_COOKIE = "girici-prefs";
/** The sites this browser opened, so the root can list and clear them. */
export const SITES_COOKIE = "__Secure-girici-sites";
export const PLAIN_SITES_COOKIE = "girici-sites";
/** Leaves room under the browsers' 4096-byte cookie limit for the name and attributes. */
export const VISITED_LIMIT_BYTES = 3000;

/** 400 days, the longest lifetime browsers keep. */
const MAX_AGE_SECONDS = 34_560_000;
const COOKIE_PATH = "/_g/sites";
/** Safari drops Secure cookies on plain http, so those pages get the unprefixed name, as with the session. */
const COOKIE_NAMES = {
  prefs: [PREFS_COOKIE, PLAIN_PREFS_COOKIE],
  sites: [SITES_COOKIE, PLAIN_SITES_COOKIE],
} as const;

export function signPrefs(prefs: SitePrefs, keys: SiteKeys): string {
  return signValue(keys.cookies, "prefs", { ...prefs });
}

export function signVisited(sites: readonly string[], keys: SiteKeys): string {
  return signValue(keys.cookies, "sites", sites);
}

/**
 * A page on any site host can add same-name cookies holding other values this server signed, so every value that
 * verifies counts and the most private choice wins, as does showing the shared-link warning; the rest comes from the
 * first.
 */
export function readPrefsCookie(cookieHeader: string | undefined, keys: SiteKeys): SitePrefs {
  const verified = cookieValues(cookieHeader, [PREFS_COOKIE, PLAIN_PREFS_COOKIE])
    .map((value) => openValue(keys.cookies, "prefs", value))
    .filter((opened) => opened !== null)
    .map((opened) => readSitePrefs(opened));
  const merged = verified[0] ?? readSitePrefs(null);
  for (const prefs of verified) {
    merged.blockThirdPartyCookies ||= prefs.blockThirdPartyCookies;
    merged.sealAddresses ||= prefs.sealAddresses;
    merged.seen &&= prefs.seen;
  }
  return merged;
}

/** Every value that verifies adds its sites, so a planted value can hide none of them from clearing. */
export function readVisited(cookieHeader: string | undefined, keys: SiteKeys): string[] {
  const visited: string[] = [];
  for (const value of cookieValues(cookieHeader, [SITES_COOKIE, PLAIN_SITES_COOKIE])) {
    const sites = openValue(keys.cookies, "sites", value);
    if (!Array.isArray(sites)) continue;
    for (const site of sites) if (typeof site === "string" && !visited.includes(site)) visited.push(site);
  }
  return visited;
}

/** Newest first; the oldest sites fall off once the signed list would outgrow the cookie. */
export function rememberSite(list: readonly string[], site: string): string[] {
  const next = [site, ...list.filter((entry) => entry !== site)];
  while (next.length > 1 && signedLength(next) > VISITED_LIMIT_BYTES) next.pop();
  return next;
}

/** A `Set-Cookie` value for every host under the domain, kept off everything outside `/_g/sites`. */
export function siteCookie(name: "prefs" | "sites", value: string, domain: SiteDomain, https: boolean): string {
  const [secureName, plainName] = COOKIE_NAMES[name];
  const prefix = `${https ? secureName : plainName}=${value}; Max-Age=${MAX_AGE_SECONDS}; Domain=${domain.host}`;
  return `${prefix}; Path=${COOKIE_PATH}; HttpOnly${https ? "; Secure" : ""}; SameSite=Lax`;
}
