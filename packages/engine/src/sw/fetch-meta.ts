import { getDomain } from "tldts";

export type FetchSite = "none" | "same-origin" | "same-site" | "cross-site";

/** Recomputed from real URLs, since the browser only ever sees our own origin. */
export function secFetchSite(initiator: URL | null, target: URL): FetchSite {
  if (!initiator) return "none";
  if (initiator.origin === target.origin) return "same-origin";
  if (initiator.protocol === target.protocol) {
    if (initiator.hostname === target.hostname) return "same-site";
    const domain = getDomain(initiator.hostname);
    if (domain && domain === getDomain(target.hostname)) return "same-site";
  }
  return "cross-site";
}
