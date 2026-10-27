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

/** Follows the Referrer Policy spec; an empty policy means the browser default. */
export function refererFor(initiator: URL | null, target: URL, policy: ReferrerPolicy): string | null {
  if (!initiator) return null;
  const full = withoutSecrets(initiator);
  const origin = `${initiator.origin}/`;
  const sameOrigin = initiator.origin === target.origin;
  const downgrade = initiator.protocol === "https:" && target.protocol === "http:";
  switch (policy) {
    case "no-referrer":
      return null;
    case "unsafe-url":
      return full;
    case "origin":
      return origin;
    case "same-origin":
      return sameOrigin ? full : null;
    case "origin-when-cross-origin":
      return sameOrigin ? full : origin;
    case "strict-origin":
      return downgrade ? null : origin;
    case "no-referrer-when-downgrade":
      return downgrade ? null : full;
    default:
      if (sameOrigin) return full;
      return downgrade ? null : origin;
  }
}

function withoutSecrets(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = "";
  copy.username = "";
  copy.password = "";
  return copy.href;
}
