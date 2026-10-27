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

/** noindex keeps proxied pages out of search results under our domain; no-referrer keeps proxy URLs out of Referer. */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    });
    next();
  };
}
