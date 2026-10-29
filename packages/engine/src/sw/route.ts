import { decodeUrl, encodeUrl, isReservedPath } from "../shared/codec.ts";
import { LOGIN_PATH, POT_PATH, SETUP_PATH, WS_SEAL_PATH } from "../shared/protocol.ts";

export type Route =
  | { kind: "passthrough" }
  | { kind: "proxy"; target: URL; navigation: boolean }
  | { kind: "redirect"; location: string }
  | { kind: "invalid" };

export interface RouteInput {
  url: string;
  origin: string;
  navigation: boolean;
  clientUrl: string | null;
  referrer: string | null;
}

export function classifyRequest(input: RouteInput): Route {
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return { kind: "passthrough" };

  if (url.origin !== input.origin) {
    // Absolute URLs that escaped rewriting still reach the worker as cross-origin subresources.
    if (realUrlOf(input.clientUrl, input.origin)) return { kind: "proxy", target: url, navigation: false };
    // The Girici UI may reach out on its own; a blank or srcdoc frame must not touch the real site directly.
    if (input.clientUrl && isOwnOrigin(input.clientUrl, input.origin)) return { kind: "passthrough" };
    return { kind: "proxy", target: url, navigation: false };
  }
  if (isReservedPath(url.pathname)) return { kind: "passthrough" };

  const pathAndQuery = url.pathname + url.search;
  if (url.pathname === "/~" || url.pathname.startsWith("/~/")) {
    const target = decodeUrl(pathAndQuery);
    if (!target) return { kind: "invalid" };
    const canonical = encodeUrl(target);
    return canonical === pathAndQuery
      ? { kind: "proxy", target, navigation: input.navigation }
      : { kind: "redirect", location: canonical };
  }

  // A root-relative URL the page resolved against our origin belongs to the page's real origin.
  const base = realUrlOf(input.navigation ? input.referrer : input.clientUrl, input.origin);
  return base ? { kind: "redirect", location: encodeUrl(new URL(pathAndQuery, base.origin)) } : { kind: "passthrough" };
}

/** True when the value is a URL on our own origin, such as the Girici UI (but not necessarily a proxied page). */
function isOwnOrigin(value: string, origin: string): boolean {
  try {
    return new URL(value).origin === origin;
  } catch {
    return false;
  }
}

/** The real URL behind one of our proxy URLs, or null for the Girici UI and foreign URLs. */
export function realUrlOf(value: string | null, origin: string): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.origin === origin ? decodeUrl(url.pathname + url.search) : null;
}

/** The parts of a Client the authority checks read. */
export interface ClientShape {
  type: string;
  frameType: string;
  url: string;
}

const UI_ROUTES = new Set(["/", "/settings", "/account", LOGIN_PATH, SETUP_PATH]);
const WORKER_ONLY = new Set([POT_PATH, WS_SEAL_PATH]);
const ADMIN_PATHS = new Set(["/_g/account", "/_g/logout", LOGIN_PATH, SETUP_PATH]);
const ADMIN_PREFIXES = ["/_g/admin/", "/_g/auth/"];

/**
 * True for a Girici UI page: a top-level window on one of the UI's own routes. Workers that proxied pages start, this
 * worker's error pages and blob: documents all sit on our origin too, and frames and popups can be scripted.
 */
export function isUiWindow(client: ClientShape | null | undefined, origin: string): boolean {
  if (!client || client.type !== "window" || client.frameType !== "top-level") return false;
  try {
    const url = new URL(client.url);
    return url.origin === origin && UI_ROUTES.has(normalizePath(url.pathname));
  } catch {
    return false;
  }
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
 * calls and top-level page loads pass; the worker's own fetches never come through its fetch handler.
 */
export function reservedAccess(
  pathname: string,
  request: ReservedRequest,
  client: ClientShape | null | undefined,
  origin: string,
): "allow" | "deny" {
  if (WORKER_ONLY.has(normalizePath(pathname))) return "deny";
  if (request.mode === "navigate") {
    return request.destination === "document" && request.method === "GET" ? "allow" : "deny";
  }
  return isUiWindow(client, origin) ? "allow" : "deny";
}
