import type { RequestHandler } from "express";

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
