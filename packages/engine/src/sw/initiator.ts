import { decodeUrl } from "../shared/codec.ts";
import type { OpenSealed } from "../shared/sealed-address.ts";
import { realUrlOf, type SiteRouting } from "./route.ts";

/**
 * Stands for a navigation from another site whose real address is unknown: cross-site for SameSite and fetch
 * metadata, with no Referer and an opaque Origin. Compared by identity, so no real URL can pass for it.
 */
export const CROSS_SITE: URL = Object.freeze(new URL("https://cross-site.invalid/"));

export function isCrossSite(url: URL | null): boolean {
  return url === CROSS_SITE;
}

/**
 * The real page a navigation came from. A label cannot be inverted, so a referrer on another site host counts only
 * when its own path names a site that lives there; anything else from that host is cross-site.
 */
export function navigationInitiator(
  referrer: string | null,
  origin: string,
  open: OpenSealed | undefined,
  site: SiteRouting | null,
): URL | null {
  const today = realUrlOf(referrer, origin, open);
  if (!site || !referrer || today) return today;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  // Any host under the site domain other than the root counts, since none of them is a direct navigation.
  if (url.origin === origin || !url.host.endsWith(`.${site.domain.value}`)) return null;
  const real = decodeUrl(url.pathname + url.search);
  return real && site.hostOf(real) === url.origin ? real : CROSS_SITE;
}
