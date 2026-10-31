import { toProxyPath } from "./target";

export type NextTarget = { kind: "route"; path: string } | { kind: "proxy"; path: string } | { kind: "home" };

const PROXY_PATH = /^\/~\//;
// "//host" and "/\host" would leave Girici, so only a single leading slash counts as one of our pages.
const OWN_PATH = /^\/(?![/\\])/;
const WEB_URL = /^https?:\/\//i;

/**
 * Where sign-in continues: a Girici page the router guard sent here, a proxy address the service worker sent here
 * (sealed or not), or the real URL of a proxied page, which reopens through the proxy.
 */
export function resolveNext(next: string): NextTarget {
  if (PROXY_PATH.test(next)) return { kind: "proxy", path: next };
  if (OWN_PATH.test(next)) return { kind: "route", path: next };
  const proxied = WEB_URL.test(next) ? toProxyPath(next) : null;
  return proxied ? { kind: "proxy", path: proxied } : { kind: "home" };
}
