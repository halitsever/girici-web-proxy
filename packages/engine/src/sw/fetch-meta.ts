import { getDomain } from "tldts";

export type FetchSite = "none" | "same-origin" | "same-site" | "cross-site";

/** Recomputed from real URLs, since the browser only ever sees our own origin; `privateDomains` as in `schemefulSite`. */
export function secFetchSite(initiator: URL | null, target: URL, privateDomains = false): FetchSite {
  if (!initiator) return "none";
  if (initiator.origin === target.origin) return "same-origin";
  if (initiator.protocol === target.protocol) {
    if (initiator.hostname === target.hostname) return "same-site";
    const options = { allowPrivateDomains: privateDomains };
    const domain = getDomain(initiator.hostname, options);
    if (domain && domain === getDomain(target.hostname, options)) return "same-site";
  }
  return "cross-site";
}
