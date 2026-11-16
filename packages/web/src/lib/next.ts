import { classifySiteHost, parseSiteDomain, type SiteDomain } from "@girici/engine/shared";
import { siteUrlPattern } from "./sites";
import { toProxyPath } from "./target";

export type NextTarget =
  { kind: "route"; path: string } | { kind: "proxy"; path: string } | { kind: "site"; url: string } | { kind: "home" };

const PROXY_PATH = /^\/~\//;
// "//host" and "/\host" would leave Girici, so only a single leading slash counts as one of our pages.
const OWN_PATH = /^\/(?![/\\])/;
const WEB_URL = /^https?:\/\//i;

/**
 * Where sign-in continues: a Girici page the router guard sent here, a proxy address the service worker sent here
 * (sealed or not), or the real URL of a proxied page, which reopens through the proxy. In subdomain mode a site host's
 * worker sends its own absolute address, which is followed only on this instance's site hosts.
 */
export function resolveNext(next: string, siteDomain?: string | null): NextTarget {
  if (PROXY_PATH.test(next)) return { kind: "proxy", path: next };
  if (OWN_PATH.test(next)) return { kind: "route", path: next };
  const domain = siteDomain ? parseSiteDomain(siteDomain) : null;
  const url = domain && WEB_URL.test(next) ? parseUrl(next) : null;
  if (domain && url) {
    if (siteUrlPattern(domain.value).test(next) && classifySiteHost(url.host, domain).kind === "site") {
      return { kind: "site", url: url.href };
    }
    if (isGiriciUrl(url, domain)) return { kind: "home" };
  }
  const proxied = WEB_URL.test(next) ? toProxyPath(next) : null;
  return proxied ? { kind: "proxy", path: proxied } : { kind: "home" };
}

/** Our own hosts never reopen through the proxy, and a proxy address on any other host belongs to another Girici. */
function isGiriciUrl(url: URL, domain: SiteDomain): boolean {
  const host = url.hostname;
  return host === domain.host || host.endsWith(`.${domain.host}`) || PROXY_PATH.test(url.pathname);
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}
