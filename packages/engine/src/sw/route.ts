import { decodeUrl, encodeUrl, isReservedPath } from "../shared/codec.ts";

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
    return realUrlOf(input.clientUrl, input.origin)
      ? { kind: "proxy", target: url, navigation: false }
      : { kind: "passthrough" };
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
