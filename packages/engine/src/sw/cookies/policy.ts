import { getDomain } from "tldts";

export type SameSiteContext = "strict" | "lax" | "none";

/** Decides from real URLs which SameSite cookies a request carries, since the browser only ever sees our origin. */
export function sameSiteContext(
  initiator: URL | null,
  target: URL,
  options: { topLevel: boolean; method: string; privateDomains?: boolean },
): SameSiteContext {
  const { privateDomains } = options;
  if (!initiator || schemefulSite(initiator, privateDomains) === schemefulSite(target, privateDomains)) return "strict";
  const safe = options.method === "GET" || options.method === "HEAD";
  return options.topLevel && safe ? "lax" : "none";
}

export function allowsCredentials(credentials: RequestCredentials, initiator: URL | null, target: URL): boolean {
  if (credentials === "include") return true;
  if (credentials === "omit") return false;
  return !initiator || initiator.origin === target.origin;
}

/**
 * Scheme plus registrable domain, the unit SameSite and third-party checks compare. Subdomain mode gives each name in
 * the private part of the public suffix list a host of its own, so `privateDomains` counts them as sites too.
 */
export function schemefulSite(url: URL, privateDomains = false): string {
  return `${url.protocol}//${getDomain(url.hostname, { allowPrivateDomains: privateDomains }) ?? url.hostname}`;
}
