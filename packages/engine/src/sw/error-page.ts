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
  runtime:
    "Girici could not verify its page script. If a CDN or proxy in front of this server rewrites or minifies JavaScript, turn that off for /_g/.",
  sealed:
    "This address was sealed in another browser, or this browser's address key was reset. Open the site again from Girici.",
};

export function errorPage(code: ErrorPageCode, target: URL | null): string {
  const message = (MESSAGES[code] ?? MESSAGES.connect).replace("{host}", escapeHtml(target?.host ?? "the site"));
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
export function errorResponse(code: ErrorPageCode, status: number, target: URL | null): Response {
  return new Response(errorPage(code, target), {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...inertHeaders(),
      "cross-origin-opener-policy": "same-origin",
    },
  });
}

/** Every service-worker refusal is an inert document, so a navigation to it cannot run script on our origin. */
export function forbiddenResponse(): Response {
  return new Response(null, { status: 403, headers: inertHeaders() });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
