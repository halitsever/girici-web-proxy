/**
 * The site a host label is computed from. It needs the public suffix list, so only the service worker and the server
 * load it; the page runtime gets labels from its config and its worker instead.
 */

import { getDomain, getPublicSuffix } from "tldts";
import { endsWith, protocolOf, sliceOf, urlPart } from "./primordials.ts";

const WITH_PRIVATE = { __proto__: null, allowPrivateDomains: true } as { allowPrivateDomains: boolean };

/** Scheme plus registrable domain, private suffixes included, so `alice.github.io` and `bob.github.io` differ. */
export function labelSiteOf(url: URL): string {
  let host = urlPart(url, "hostname");
  if (endsWith(host, ".")) host = sliceOf(host, 0, host.length - 1);
  return `${protocolOf(url)}//${getDomain(host, WITH_PRIVATE) ?? host}`;
}

export function isPublicSuffix(host: string): boolean {
  return getPublicSuffix(host, WITH_PRIVATE) === host;
}
