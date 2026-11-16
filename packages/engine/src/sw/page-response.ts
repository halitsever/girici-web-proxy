import { rewriteCss } from "../rewrite/css.ts";
import { rewriteHtml } from "../rewrite/html.ts";
import { rewriteJs } from "../rewrite/js.ts";
import { rewriteRefresh } from "../rewrite/refresh.ts";
import { clientTag } from "../shared/client-tag.ts";
import { encodeUrl } from "../shared/codec.ts";
import {
  encodeHeaderValue,
  CHALLENGE_PATH,
  HEADER,
  LOGIN_PATH,
  PROTOCOL_VERSION,
  type ClientConfig,
  type CookieSnapshot,
  type OriginSeal,
  type RelayErrorCode,
} from "../shared/protocol.ts";
import {
  contentTypeOf,
  decodeText,
  isDocumentLoad,
  mimeOf,
  rewriteKind,
  sandboxesDocument,
  sniffsHtml,
  SNIFF_BYTES,
  type BodyKind,
} from "./body.ts";
import { cacheKey, RewriteMemo, type Validators } from "./rewrite-cache.ts";
import { schemefulSite } from "./cookies/policy.ts";
import { errorResponse, inertHeaders } from "./error-page.ts";
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
  /** Resolves false when the page runtime cannot be verified, so no page is served without it. */
  runtimeAvailable?: () => Promise<boolean>;
  /** Set for a document on a sealed address: its runtime gets this, and its relative URLs are written absolute. */
  seal?: OriginSeal;
  /** Set for a top-level load while sealing is on: the address its redirects and sign-in `next` point to. */
  address?: (url: URL) => string;
}

const rewrites = new RewriteMemo();

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
/** Reads the first bytes for sniffing and hands back a stream that still starts with them, so large files keep streaming. */
async function peek(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ head: ArrayBuffer; body: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  const head = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    head.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { head: head.buffer, body: replay };
}

// The browser already decoded the relay body, so the upstream encoding and length no longer apply.
const DROPPED_HEADERS = new Set(["content-encoding", "content-length", "set-cookie"]);
const REWRITTEN_TYPES: Record<BodyKind, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

export async function buildPageResponse(result: TransportResult, ctx: PageContext): Promise<Response> {
  if (!result.ok) return failure(result.code, result.status, ctx, result.retryAfter);
  const { status, headers: envelope } = result.response;
  let body = result.response.body;

  if (REDIRECT_STATUSES.has(status)) {
    const location = envelope.find(([name]) => name === "location")?.[1];
    if (location) return redirectTo(location, status, ctx);
  }
  if (!Number.isInteger(status) || status < 200 || status > 599) return failure("connect", 502, ctx);

  const headers = new Headers();
  for (const [name, value] of envelope) {
    if (DROPPED_HEADERS.has(name) || name.startsWith("x-girici-")) continue;
    try {
      const next = name === "refresh" ? rewriteRefresh(value, ctx.target, ctx.origin, !!ctx.seal) : value;
      // An empty refresh is one that would have loaded a blob document.
      if (next !== "" || value === "") headers.append(name, next);
    } catch {
      // A value the Headers API rejects would otherwise fail the whole response.
    }
  }
  // The runtime applies these before the page sees the response, as browsers update document.cookie.
  if (ctx.syncCookies?.length) headers.set(HEADER.cookieSync, encodeHeaderValue(JSON.stringify(ctx.syncCookies)));
  if (NULL_BODY_STATUSES.has(status) || !body) return new Response(null, { status, headers });

  let contentType = headers.get("content-type");
  let kind = rewriteKind(ctx.destination, ctx.navigation, contentType);
  if (!kind && isDocumentLoad(ctx.destination, ctx.navigation) && !mimeOf(contentType)) {
    // A browser sniffs an untyped document, so one that starts like HTML is a page and gets the runtime.
    const peeked = await peek(body, SNIFF_BYTES);
    body = peeked.body;
    if (sniffsHtml(peeked.head)) {
      kind = "html";
      contentType = "text/html";
    }
  }
  if (!kind) {
    // The relay hop already decoded any content-encoding, so the upstream length is right only for an identity body.
    const encoded = envelope.some(([name]) => name === "content-encoding");
    const length = envelope.find(([name]) => name === "content-length")?.[1];
    if (!encoded && length) headers.set("content-length", length);
    if (sandboxesDocument(ctx.destination, ctx.navigation, contentType)) {
      for (const [name, value] of Object.entries(inertHeaders())) headers.set(name, value);
      // With nosniff, a missing type leaves some browsers an empty document.
      headers.set("content-type", contentTypeOf(contentType) ?? "text/plain; charset=utf-8");
    } else if (isDocumentLoad(ctx.destination, ctx.navigation)) {
      // The browser parses the header on its own, so it may only ever see the one type decided here.
      const type = contentTypeOf(contentType);
      if (type) headers.set("content-type", type);
    }
    return new Response(body, { status, headers });
  }
  const validators: Validators = {
    etag: envelope.find(([name]) => name === "etag")?.[1] ?? null,
    lastModified: envelope.find(([name]) => name === "last-modified")?.[1] ?? null,
    length: envelope.find(([name]) => name === "content-length")?.[1] ?? null,
  };
  if (kind === "html" && ctx.runtimeAvailable && !(await ctx.runtimeAvailable())) {
    return errorResponse("runtime", 503, ctx.target);
  }
  const text = decodeText(await new Response(body).arrayBuffer(), contentType);
  headers.set("content-type", REWRITTEN_TYPES[kind]);
  return new Response(await rewriteBody(kind, text, ctx, validators), { status, headers });
}

async function rewriteBody(kind: BodyKind, text: string, ctx: PageContext, validators: Validators): Promise<string> {
  switch (kind) {
    case "html": {
      const config: ClientConfig = {
        v: PROTOCOL_VERSION,
        cookies: await ctx.cookies(),
        site: schemefulSite(ctx.target),
      };
      if (ctx.cookiesBlocked) config.cookiesBlocked = true;
      const clientUrl = new URL(ctx.clientScript, ctx.origin).href;
      const inject = clientTag(clientUrl, ctx.seal ? { ...config, seal: ctx.seal } : config);
      // A srcdoc frame has no sealed address of its own, so it never gets the key.
      const frameInject = (base: URL) =>
        clientTag(clientUrl, { ...config, inherit: { origin: ctx.origin, base: base.href } });
      return rewriteHtml(text, { url: ctx.target, origin: ctx.origin, inject, frameInject, opaque: !!ctx.seal });
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
function cachedRewrite(target: URL, validators: Validators, rewrite: () => string): string {
  const key = cacheKey(target, "js", validators);
  if (!key) return rewrite();
  const cached = rewrites.get(key);
  if (cached !== null) return cached;
  const rewritten = rewrite();
  rewrites.set(key, rewritten);
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
  const address = ctx.address ?? encodeUrl;
  return Response.redirect(web ? new URL(address(resolved), ctx.origin).href : resolved.href, status);
}

const WAITS: ReadonlySet<RelayErrorCode> = new Set(["quota", "rate_limited"]);

function failure(code: RelayErrorCode, status: number, ctx: PageContext, retryAfter?: number): Response {
  if (!ctx.navigation) return Response.error();
  if (code === "auth") return Response.redirect(uiPageFor(LOGIN_PATH, ctx), 303);
  // The challenge page refuses to be framed, so only a top-level load can be sent there.
  if (code === "challenge" && ctx.destination === "document")
    return Response.redirect(uiPageFor(CHALLENGE_PATH, ctx), 303);
  const wait = WAITS.has(code) ? retryAfter : undefined;
  return errorResponse(code, status >= 400 && status <= 599 ? status : 502, ctx.target, wait);
}

/** A UI page that sends the visitor back afterwards, to the sealed address when the load was sealed. */
function uiPageFor(path: string, ctx: PageContext): string {
  const page = new URL(path, ctx.origin);
  page.searchParams.set("next", ctx.address ? ctx.address(ctx.target) : ctx.target.href);
  return page.href;
}
