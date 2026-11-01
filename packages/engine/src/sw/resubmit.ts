/**
 * WebKit drops the body of a POST navigation when it follows a redirect this worker made, so a form posted to another
 * site's host is rebuilt as a page that posts the same fields there itself.
 */

import { mimeOf } from "../shared/charset.ts";
import { escapeAttribute } from "../shared/client-tag.ts";

// A field named "submit" would shadow the form's own method.
const SCRIPT = "HTMLFormElement.prototype.submit.call(document.forms[0])";
const REBUILT = new Set(["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]);

let scriptHash: Promise<string> | null = null;

/** Null when the body cannot be rebuilt, such as one with files; the caller then redirects instead. */
export async function resubmitResponse(request: Request, location: string): Promise<Response | null> {
  const type = mimeOf(request.headers.get("content-type")) ?? "";
  if (!REBUILT.has(type)) return null;
  let entries: Array<[string, string]> | null;
  try {
    entries = await entriesOf(request.clone(), type);
  } catch {
    return null;
  }
  if (!entries) return null;
  const target = new URL(location);
  const domain = target.host.slice(target.host.indexOf(".") + 1);
  let fields = "";
  for (const [name, value] of entries) {
    fields += `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`;
  }
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Girici</title>
  </head>
  <body>
    <form method="post" action="${escapeAttribute(location)}" enctype="${type}" accept-charset="utf-8">${fields}<noscript><button type="submit">Continue</button></noscript></form>
    <script>${SCRIPT}</script>
  </body>
</html>
`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        `default-src 'none'; script-src 'sha256-${await hashOfScript()}'; form-action ${target.origin}; ` +
        `base-uri 'none'; frame-ancestors 'self' *.${domain}`,
      "x-content-type-options": "nosniff",
      // The other host reads the origin to treat the post as cross-site; the path stays here.
      "referrer-policy": "strict-origin",
      "origin-agent-cluster": "?1",
    },
  });
}

async function entriesOf(request: Request, type: string): Promise<Array<[string, string]> | null> {
  if (type === "application/x-www-form-urlencoded") return [...new URLSearchParams(await request.text())];
  if (type === "text/plain") return plainEntries(await request.text());
  const entries: Array<[string, string]> = [];
  for (const [name, value] of await request.formData()) {
    if (typeof value !== "string") return null;
    entries.push([name, value]);
  }
  return entries;
}

/** text/plain writes `name=value` lines without escaping, so a line with no `=` continues the value before it. */
function plainEntries(body: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const lines = body.split("\r\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const at = line.indexOf("=");
    const last = entries.at(-1);
    if (at < 0 && last) last[1] += `\r\n${line}`;
    else entries.push(at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)]);
  }
  return entries;
}

function hashOfScript(): Promise<string> {
  scriptHash ??= crypto.subtle.digest("SHA-256", new TextEncoder().encode(SCRIPT)).then((digest) => {
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return scriptHash;
}
