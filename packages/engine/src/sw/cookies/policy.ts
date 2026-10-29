import { getDomain } from "tldts";

export type SameSiteContext = "strict" | "lax" | "none";

/** Decides from real URLs which SameSite cookies a request carries, since the browser only ever sees our origin. */
export function sameSiteContext(
  initiator: URL | null,
  target: URL,
  options: { topLevel: boolean; method: string },
): SameSiteContext {
  if (!initiator || schemefulSite(initiator) === schemefulSite(target)) return "strict";
  const safe = options.method === "GET" || options.method === "HEAD";
  return options.topLevel && safe ? "lax" : "none";
}

export function allowsCredentials(credentials: RequestCredentials, initiator: URL | null, target: URL): boolean {
  if (credentials === "include") return true;
  if (credentials === "omit") return false;
  return !initiator || initiator.origin === target.origin;
}

/** Scheme plus registrable domain, the unit SameSite and third-party checks compare. */
export function schemefulSite(url: URL): string {
  return `${url.protocol}//${getDomain(url.hostname) ?? url.hostname}`;
}
