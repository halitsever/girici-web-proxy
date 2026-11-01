import type { RelayErrorCode } from "../shared/protocol.ts";

/** A runtime that failed verification, or an address this browser cannot open, is not a relay error. */
export type ErrorPageCode = RelayErrorCode | "runtime" | "sealed";

export const SANDBOX_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** A sandbox without allow-scripts or allow-same-origin gives the document an opaque origin and no script. */
export function inertHeaders(): Record<string, string> {
  return { "content-security-policy": SANDBOX_CSP, "x-content-type-options": "nosniff" };
}

const MESSAGES: Record<ErrorPageCode, string> = {
  ssrf_blocked: "Girici does not open local or private network addresses.",
  dns: "Girici could not find {host}.",
  connect: "Girici could not connect to {host}.",
  tls: "{host} sent an invalid certificate.",
  timeout: "{host} took too long to respond.",
  too_large: "The request is too large.",
  bad_request: "This address cannot be opened through Girici.",
  header_overflow: "{host} sent headers that are too large.",
  auth: "Girici needs you to sign in before opening {host}.",
  rate_limited: "Too many requests from your network. Wait a moment, then reload.",
  blocked: "{host} is blocked on this Girici server.",
  proxy: "Girici's upstream proxy could not reach {host}.",
  quota: "Your network has used up its data allowance on this Girici server. Try again {wait}.",
  challenge: "Girici needs to check this browser before it opens {host}. Reload the page.",
  runtime:
    "Girici could not verify its page script. If a CDN or proxy in front of this server rewrites or minifies JavaScript, turn that off for /_g/.",
  sealed:
    "This address was sealed in another browser, or this browser's address key was reset. Open the site again from Girici.",
};

/** The server's Retry-After in words, rounded up so the page never promises an earlier time. */
export function waitText(seconds: number | undefined): string {
  if (seconds === undefined) return "later";
  if (seconds <= 90) return "in a minute";
  if (seconds < 90 * 60) return `in ${Math.ceil(seconds / 60)} minutes`;
  return `in ${Math.ceil(seconds / 3600)} hours`;
}

export function errorPage(code: ErrorPageCode, target: URL | null, retryAfter?: number): string {
  const message = (MESSAGES[code] ?? MESSAGES.connect)
    .replace("{host}", () => escapeHtml(target?.host ?? "the site"))
    .replace("{wait}", () => waitText(retryAfter));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Girici</title>
  </head>
  <body>
    <h1>Girici</h1>
    <p>${message}</p>
    <p><a href="/">Back to Girici</a></p>
  </body>
</html>
`;
}

/** Error pages run no script and keep no opener, so a proxied page cannot borrow their realm on our origin. */
export function errorResponse(code: ErrorPageCode, status: number, target: URL | null, retryAfter?: number): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...inertHeaders(),
    "cross-origin-opener-policy": "same-origin",
  };
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  return new Response(errorPage(code, target, retryAfter), { status, headers });
}

/** Every service-worker refusal is an inert document, so a navigation to it cannot run script on our origin. */
export function forbiddenResponse(): Response {
  return new Response(null, { status: 403, headers: inertHeaders() });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
