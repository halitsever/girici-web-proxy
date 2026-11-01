import { decodeUrl, encodeUrl, isReservedPath, PROXY_PREFIX } from "../shared/codec.ts";
import { LOGIN_PATH, POT_PATH, SETUP_PATH, WS_SEAL_PATH } from "../shared/protocol.ts";
import { isSealedPath, SEALED_PREFIX, type OpenSealed } from "../shared/sealed-address.ts";
import type { SiteDomain } from "../shared/site-label.ts";

export type Route =
  | { kind: "passthrough" }
  | { kind: "proxy"; target: URL; navigation: boolean; sealed: boolean }
  | { kind: "redirect"; location: string }
  | { kind: "invalid" }
  | { kind: "unsealable" }
  /** An absolute address on another site host. */
  | { kind: "move"; location: string }
  /** A navigation that cannot be placed before this browser signs in. */
  | { kind: "signin"; target: URL };

/** Subdomain mode as the router sees it. */
export interface SiteRouting {
  /** This host's origin. */
  origin: string;
  domain: SiteDomain;
  /** The origin of the host that serves a URL's site, or null without the label key. */
  hostOf(url: URL): string | null;
}

export interface RouteInput {
  url: string;
  origin: string;
  navigation: boolean;
  clientUrl: string | null;
  referrer: string | null;
  /** A navigation of a top-level document by GET, the only load that gets a sealed address. */
  topLevelGet?: boolean;
  open?: OpenSealed;
  /** Given while sealing is on, or for a sealed request while this browser has the key. */
  seal?: (url: URL) => string;
  site?: SiteRouting;
}

export function classifyRequest(input: RouteInput): Route {
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "passthrough" };

  if (url.origin !== input.origin) {
    // Absolute URLs that escaped rewriting still reach the worker as cross-origin subresources.
    if (realUrlOf(input.clientUrl, input.origin, input.open) || isSealedClient(input.clientUrl, input.origin)) {
      return { kind: "proxy", target: url, navigation: false, sealed: false };
    }
    // The Girici UI may reach out on its own; a blank or srcdoc frame must not touch the real site directly.
    if (input.clientUrl && isOwnOrigin(input.clientUrl, input.origin)) return { kind: "passthrough" };
    return { kind: "proxy", target: url, navigation: false, sealed: false };
  }
  if (isHostReservedPath(url.pathname, !!input.site)) return { kind: "passthrough" };

  const pathAndQuery = url.pathname + url.search;
  const sealOnLoad = input.topLevelGet ? input.seal : undefined;
  if (isSealedPath(url.pathname)) {
    // URL.search drops a bare "?", which still means a query emptied the way a form with no fields empties it.
    const bare = url.search === "" && url.href.endsWith("?") ? "?" : "";
    const target = input.open?.(pathAndQuery + bare) ?? null;
    if (target) {
      const away = placeOf(target, input);
      if (away) return away;
      const address = sealOnLoad?.(target);
      // A query written after the token is sealed in, so the address bar never shows it.
      if (address !== undefined && address !== pathAndQuery) return { kind: "redirect", location: address };
      return { kind: "proxy", target, navigation: input.navigation, sealed: true };
    }
    // A relative URL resolved against a sealed address lands under /~/x/, which mirrors the page's directory.
    return relativeToSealed(sliceAfter(pathAndQuery, SEALED_PREFIX), input);
  }
  if (url.pathname === "/~" || url.pathname.startsWith(PROXY_PREFIX)) {
    const target = decodeUrl(pathAndQuery);
    if (!target) {
      // One "../" too many from a sealed page climbs out of /~/x/ into /~/.
      const base = sealedBase(input);
      return base ? relativeToSealed(`../${sliceAfter(pathAndQuery, PROXY_PREFIX)}`, input) : { kind: "invalid" };
    }
    // Another host seals its own site's addresses, so a move carries the plain one.
    const away = placeOf(target, input);
    if (away) return away;
    if (sealOnLoad) return { kind: "redirect", location: sealOnLoad(target) };
    const canonical = encodeUrl(target);
    if (canonical !== pathAndQuery) return { kind: "redirect", location: canonical };
    return { kind: "proxy", target, navigation: input.navigation, sealed: false };
  }

  // A root-relative URL the page resolved against our origin belongs to the page's real origin.
  const from = input.navigation ? input.referrer : input.clientUrl;
  const base = realUrlOf(from, input.origin, input.open);
  // A sealed page whose address does not open here must not reach the Girici server with its cookies.
  if (!base) return isSealedClient(from, input.origin) ? { kind: "unsealable" } : { kind: "passthrough" };
  const real = new URL(pathAndQuery, base.origin);
  return placeOf(real, input) ?? { kind: "redirect", location: sealOnLoad ? sealOnLoad(real) : encodeUrl(real) };
}

/** In subdomain mode a navigation whose site lives on another host goes there; null keeps it on this one. */
function placeOf(target: URL, input: RouteInput): Route | null {
  const site = input.site;
  if (!site || !input.navigation) return null;
  const host = site.hostOf(target);
  if (host === null) return { kind: "signin", target };
  return host === site.origin ? null : { kind: "move", location: host + encodeUrl(target) };
}

/** Resolves a path the browser placed under a sealed page against that page's real address. */
function relativeToSealed(relative: string, input: RouteInput): Route {
  const base = sealedBase(input);
  if (!base) return { kind: "unsealable" };
  let real: URL;
  try {
    real = new URL(relative, base);
  } catch {
    return { kind: "invalid" };
  }
  // A path such as javascript:x resolves to no address the proxy can carry or seal.
  if (real.protocol !== "http:" && real.protocol !== "https:") return { kind: "invalid" };
  if (input.navigation) {
    const away = placeOf(real, input);
    if (away) return away;
    return { kind: "redirect", location: (input.topLevelGet ? input.seal?.(real) : undefined) ?? encodeUrl(real) };
  }
  return { kind: "proxy", target: real, navigation: false, sealed: false };
}

/** The real address of the sealed page a request came from: its client, or for a navigation, its referrer. */
function sealedBase(input: RouteInput): URL | null {
  const value = input.navigation ? input.referrer : input.clientUrl;
  return isSealedClient(value, input.origin) ? realUrlOf(value, input.origin, input.open) : null;
}

function isSealedClient(value: string | null, origin: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === origin && isSealedPath(url.pathname);
  } catch {
    return false;
  }
}

function sliceAfter(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : "";
}

/** True when the value is a URL on our own origin, such as the Girici UI (but not necessarily a proxied page). */
function isOwnOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/** Paths the network answers; on a site host `/` and `/robots.txt` belong to the page's own site. */
export function isHostReservedPath(pathname: string, siteMode: boolean): boolean {
  return siteMode ? pathname.startsWith("/_g/") : isReservedPath(pathname);
}

/** The real URL behind one of our proxy URLs, or null for the Girici UI and foreign URLs. */
export function realUrlOf(value: string | null, origin: string, open?: OpenSealed): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const pathAndQuery = url.pathname + url.search;
  return isSealedPath(url.pathname) ? (open?.(pathAndQuery) ?? null) : decodeUrl(pathAndQuery);
}

/** The parts of a Client the authority checks read. */
export interface ClientShape {
  id: string;
  type: string;
  frameType: string;
  url: string;
}

export interface ClientUrlInput {
  client: ClientShape | undefined;
  /** The page that started the client, for workers. */
  identity: { page: string } | null;
}

/**
 * The proxy URL a request is judged from. A worker sits on a blob: address and can send any referrer, so it takes the
 * page that started it. Chromium sends a nested worker's requests with no client at all; a request without one gets no
 * URL, whatever its referrer says.
 */
export function requestClientUrl(input: ClientUrlInput, origin: string): string | null {
  if (input.client?.type === "window") return input.client.url;
  return input.identity ? new URL(encodeUrl(new URL(input.identity.page)), origin).href : null;
}

/** The clients that real Girici UI navigations produced. */
export interface UiClientSet {
  has(id: string): boolean;
}

const UI_ROUTES = new Set(["/", "/settings", "/account", LOGIN_PATH, SETUP_PATH]);
const WORKER_ONLY = new Set([POT_PATH, WS_SEAL_PATH]);
const ADMIN_PATHS = new Set(["/_g/account", "/_g/logout", LOGIN_PATH, SETUP_PATH]);
const ADMIN_PREFIXES = ["/_g/admin/", "/_g/auth/"];

/** True for an address on one of the UI's own routes. */
export function isUiRoute(url: URL, origin: string): boolean {
  return url.origin === origin && UI_ROUTES.has(normalizePath(url.pathname));
}

/**
 * A top-level window on one of the UI's routes. Workers that proxied pages start, this worker's error pages and blob:
 * documents all sit on our origin too, and frames and popups can be scripted.
 */
export function hasUiShape(client: ClientShape, origin: string): boolean {
  if (client.type !== "window" || client.frameType !== "top-level") return false;
  try {
    return isUiRoute(new URL(client.url), origin);
  } catch {
    return false;
  }
}

/** A proxied page can make its address look like the UI's, so the client must also come from a real UI load. */
export function isUiWindow(client: ClientShape | null | undefined, origin: string, ui: UiClientSet): boolean {
  return !!client && hasUiShape(client, origin) && ui.has(client.id);
}

/** Express routes paths case-insensitively and with a trailing slash, so the checks here compare this form. */
function normalizePath(pathname: string): string {
  return pathname.toLowerCase().replace(/\/+$/, "") || "/";
}

/** The admin API, plus the endpoints only this worker calls. */
export function isGuardedPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return WORKER_ONLY.has(path) || ADMIN_PATHS.has(path) || ADMIN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export interface ReservedRequest {
  mode: RequestMode;
  destination: RequestDestination;
  method: string;
}

/**
 * Proxied pages share our origin, so the browser sends the admin's cookie with their calls too. Only the UI's own
 * calls and top-level page loads pass; the worker's own fetches never come through its fetch handler. A site host
 * has no UI, so nothing passes there.
 */
export function reservedAccess(
  pathname: string,
  request: ReservedRequest,
  client: ClientShape | null | undefined,
  origin: string,
  ui: UiClientSet,
  siteMode = false,
): "allow" | "deny" {
  if (siteMode || WORKER_ONLY.has(normalizePath(pathname))) return "deny";
  if (request.mode === "navigate") {
    return request.destination === "document" && request.method === "GET" ? "allow" : "deny";
  }
  return isUiWindow(client, origin, ui) ? "allow" : "deny";
}
