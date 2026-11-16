import type { RequestHandler } from "express";
import { requestHost } from "../sites/hosts.ts";

export const UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), usb=(), payment=()";

/** noindex keeps proxied pages out of search results under our domain; no-referrer keeps proxy URLs out of Referer. */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      // A same-origin document without the runtime would hand its window to any proxied page that frames or opens
      // it. Routes that need something else set their own.
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Cross-Origin-Opener-Policy": "same-origin",
    });
    next();
  };
}

/** Runs after `hostKinds`: in subdomain mode each host asks for its own agent cluster, and no site may embed the root. */
export function siteHeaders(): RequestHandler {
  return (_req, res, next) => {
    const { kind } = requestHost(res);
    if (kind !== "single") res.setHeader("Origin-Agent-Cluster", "?1");
    if (kind === "root") res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    next();
  };
}
