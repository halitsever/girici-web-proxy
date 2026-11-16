import { textFor } from "../shared/i18n/catalog.ts";
import { DEFAULT_LANG, type Lang } from "../shared/i18n/languages.ts";
import { fill, pluralText } from "../shared/i18n/text.ts";
import { PAGE_TEXT, type ErrorPageCode } from "./page-text.ts";

export type { ErrorPageCode } from "./page-text.ts";

export const SANDBOX_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** A sandbox without allow-scripts or allow-same-origin gives the document an opaque origin and no script. */
export function inertHeaders(): Record<string, string> {
  return { "content-security-policy": SANDBOX_CSP, "x-content-type-options": "nosniff" };
}

/** The server's Retry-After in words, rounded up so the page never promises an earlier time. */
export function waitText(seconds: number | undefined, lang: Lang = DEFAULT_LANG): string {
  const text = textFor(PAGE_TEXT, lang);
  if (seconds === undefined) return text.waitLater;
  if (seconds <= 90) return text.waitMinute;
  if (seconds < 90 * 60) return pluralText(text.waitMinutes, Math.ceil(seconds / 60), lang);
  return pluralText(text.waitHours, Math.ceil(seconds / 3600), lang);
}

/** `home` is the root's address on a site host, where `/` belongs to the page's own site. */
export function errorPage(
  code: ErrorPageCode,
  target: URL | null,
  retryAfter?: number,
  home = "/",
  lang: Lang = DEFAULT_LANG,
): string {
  const text = textFor(PAGE_TEXT, lang);
  // The texts are ours and hold no markup; only the host comes from outside.
  const message = fill(text.errors[code] ?? text.errors.connect, {
    host: escapeHtml(target?.host ?? text.someSite),
    wait: waitText(retryAfter, lang),
  });
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Girici</title>
  </head>
  <body>
    <h1>Girici</h1>
    <p>${message}</p>
    <p><a href="${escapeHtml(home)}">${text.backHome}</a></p>
  </body>
</html>
`;
}

/** Error pages run no script and keep no opener, so a proxied page cannot borrow their realm on our origin. */
export function errorResponse(
  code: ErrorPageCode,
  status: number,
  target: URL | null,
  retryAfter?: number,
  home?: string,
  lang?: Lang,
): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    ...inertHeaders(),
    "cross-origin-opener-policy": "same-origin",
  };
  if (retryAfter !== undefined) headers["retry-after"] = String(retryAfter);
  return new Response(errorPage(code, target, retryAfter, home, lang), { status, headers });
}

/** Every service-worker refusal is an inert document, so a navigation to it cannot run script on our origin. */
export function forbiddenResponse(): Response {
  // Without a type, Chromium saves a refused navigation as a download and Firefox never finishes loading it.
  return new Response("Forbidden", {
    status: 403,
    headers: { ...inertHeaders(), "content-type": "text/plain; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
