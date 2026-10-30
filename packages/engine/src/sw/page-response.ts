import { rewriteCss } from "../rewrite/css.ts";
import { rewriteHtml } from "../rewrite/html.ts";
import { rewriteJs } from "../rewrite/js.ts";
import { rewriteRefresh } from "../rewrite/refresh.ts";
import { encodeUrl } from "../shared/codec.ts";
import {
  encodeHeaderValue,
  HEADER,
  LOGIN_PATH,
  PROTOCOL_VERSION,
  type CookieSnapshot,
  type RelayErrorCode,
} from "../shared/protocol.ts";
import { decodeText, rewriteKind, type BodyKind } from "./body.ts";
import { cacheKey, readRewritten, writeRewritten, REWRITE_CACHE, type Validators } from "./rewrite-cache.ts";
import { clientTag } from "./client-tag.ts";
import { errorResponse } from "./error-page.ts";
import type { TransportResult } from "./transport.ts";

export interface PageContext {
  target: URL;
  origin: string;
  destination: RequestDestination;
  navigation: boolean;
  clientScript: string;
  cookies(): Promise<CookieSnapshot[]>;
  syncCookies?: CookieSnapshot[];
  cookiesBlocked?: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
// The browser already decoded the relay body, so the upstream encoding and length no longer apply.
const DROPPED_HEADERS = new Set(["content-encoding", "content-length", "set-cookie"]);
const REWRITTEN_TYPES: Record<BodyKind, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

export async function buildPageResponse(result: TransportResult, ctx: PageContext): Promise<Response> {
  if (!result.ok) return failure(result.code, result.status, ctx);
  const { status, headers: envelope, body } = result.response;

  if (REDIRECT_STATUSES.has(status)) {
    const location = envelope.find(([name]) => name === "location")?.[1];
    if (location) return redirectTo(location, status, ctx);
  }
  if (!Number.isInteger(status) || status < 200 || status > 599) return failure("connect", 502, ctx);

  const headers = new Headers();
  for (const [name, value] of envelope) {
    if (DROPPED_HEADERS.has(name) || name.startsWith("x-girici-")) continue;
    try {
      headers.append(name, name === "refresh" ? rewriteRefresh(value, ctx.target, ctx.origin) : value);
    } catch {
      // A value the Headers API rejects would otherwise fail the whole response.
    }
  }
  // The runtime applies these before the page sees the response, as browsers update document.cookie.
  if (ctx.syncCookies?.length) headers.set(HEADER.cookieSync, encodeHeaderValue(JSON.stringify(ctx.syncCookies)));
  if (NULL_BODY_STATUSES.has(status) || !body) return new Response(null, { status, headers });

  const contentType = headers.get("content-type");
  const kind = rewriteKind(ctx.destination, ctx.navigation, contentType);
  if (!kind) {
    // The relay hop already decoded any content-encoding, so the upstream length is right only for an identity body.
    const encoded = envelope.some(([name]) => name === "content-encoding");
    const length = envelope.find(([name]) => name === "content-length")?.[1];
    if (!encoded && length) headers.set("content-length", length);
    return new Response(body, { status, headers });
  }
  const validators: Validators = {
    etag: envelope.find(([name]) => name === "etag")?.[1] ?? null,
    lastModified: envelope.find(([name]) => name === "last-modified")?.[1] ?? null,
    length: envelope.find(([name]) => name === "content-length")?.[1] ?? null,
  };
  const text = decodeText(await new Response(body).arrayBuffer(), contentType);
  headers.set("content-type", REWRITTEN_TYPES[kind]);
  return new Response(await rewriteBody(kind, text, ctx, validators), { status, headers });
}

async function rewriteBody(kind: BodyKind, text: string, ctx: PageContext, validators: Validators): Promise<string> {
  switch (kind) {
    case "html": {
      const config = { v: PROTOCOL_VERSION, cookies: await ctx.cookies() };
      const inject = clientTag(ctx.clientScript, ctx.cookiesBlocked ? { ...config, cookiesBlocked: true } : config);
      return rewriteHtml(text, { url: ctx.target, origin: ctx.origin, inject });
    }
    case "css":
      return rewriteCss(text, ctx.target, ctx.origin);
    case "js":
      // Workers and blank frames load scripts too, and they have no runtime to call into.
      // sourceURL makes stack traces name the real script, so tamper checks that read Error().stack see no proxy URL.
      return cachedRewrite(
        ctx.target,
        validators,
        () => `${rewriteJs(text, { standalone: true })}\n//# sourceURL=${ctx.target.href}`,
      );
  }
}

/** Reuses a stored rewrite when the script carries a validator, so a repeat visit skips re-parsing a large bundle. */
async function cachedRewrite(target: URL, validators: Validators, rewrite: () => string): Promise<string> {
  const key = cacheKey(target, "js", validators);
  if (!key) return rewrite();
  const cache = await caches.open(REWRITE_CACHE);
  const cached = await readRewritten(key, cache);
  if (cached !== null) return cached;
  const rewritten = rewrite();
  await writeRewritten(key, rewritten, cache);
  return rewritten;
}

function redirectTo(location: string, status: number, ctx: PageContext): Response {
  let resolved: URL;
  try {
    resolved = new URL(location, ctx.target);
  } catch {
    return failure("connect", 502, ctx);
  }
  const web = resolved.protocol === "http:" || resolved.protocol === "https:";
  return Response.redirect(web ? new URL(encodeUrl(resolved), ctx.origin).href : resolved.href, status);
}

function failure(code: RelayErrorCode, status: number, ctx: PageContext): Response {
  if (!ctx.navigation) return Response.error();
  if (code === "auth") {
    const login = new URL(LOGIN_PATH, ctx.origin);
    login.searchParams.set("next", ctx.target.href);
    return Response.redirect(login.href, 303);
  }
  return errorResponse(code, status >= 400 && status <= 599 ? status : 502, ctx.target);
}
