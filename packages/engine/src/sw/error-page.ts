import type { RelayErrorCode } from "../shared/protocol.ts";

const MESSAGES: Record<RelayErrorCode, string> = {
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
};

export function errorPage(code: RelayErrorCode, target: URL | null): string {
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
