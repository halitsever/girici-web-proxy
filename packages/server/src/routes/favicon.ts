import { Router } from "express";
import { request, type Dispatcher } from "undici";
import { isSessionCookie } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { limitByClient, tokenBucket } from "../http/rate-limit.ts";
import type { HostBlocklist } from "../upstream/blocklist.ts";
import { validateTarget } from "../upstream/ssrf.ts";

export const FAVICON_PATH = "/_g/favicon";

export interface FaviconOptions {
  agent: Dispatcher;
  store: AuthStore;
  allowedTestHosts: ReadonlySet<string>;
  blocklist?: HostBlocklist;
  siteDomain?: string;
  /** Requests per client per minute; the home page asks for one icon per tile. */
  perMinute?: number;
  now?: () => number;
}

interface Icon {
  type: string;
  body: Buffer;
}

/** One lookup's policy: the router's options plus the host this request reached, which no hop may target. */
type Lookup = FaviconOptions & { selfHost?: string };

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
// SVG is left out: opened on its own it is a document that can run script on this origin.
const IMAGE_TYPES = new Set([
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/png",
  "image/gif",
  "image/jpeg",
  "image/webp",
]);
const MAX_ICON = 100 * 1024;
const MAX_PAGE = 256 * 1024;
const MAX_REDIRECTS = 3;
const FOUND_FOR = 24 * 60 * 60 * 1000;
const MISSING_FOR = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const ICON_LINK = /<link\b[^>]*>/gi;

/**
 * Fetches a site's icon for the home page tiles through the server's own connection, so neither the site nor a
 * third-party icon service learns who is looking.
 */
export function faviconRouter(options: FaviconOptions): Router {
  const router = Router({ caseSensitive: true, strict: true });
  const now = options.now ?? Date.now;
  const cache = new Map<string, Icon | null>();
  const times = new Map<string, number>();
  const limit = limitByClient(tokenBucket({ perMinute: options.perMinute ?? 120 }));

  const remember = (host: string, icon: Icon | null) => {
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
        times.delete(oldest);
      }
    }
    cache.set(host, icon);
    times.set(host, now());
  };

  router.get(FAVICON_PATH, limit, async (req, res, next) => {
    try {
      if (!options.store.publicAccess() && !isSessionCookie(options.store, req.headers.cookie)) {
        res.status(401).end();
        return;
      }
      const host = typeof req.query.host === "string" ? req.query.host.toLowerCase() : "";
      if (!HOST.test(host) || options.blocklist?.isBlocked(host)) {
        res.status(400).end();
        return;
      }
      const at = times.get(host);
      let icon = cache.get(host);
      if (at === undefined || now() - at > (icon ? FOUND_FOR : MISSING_FOR)) {
        icon = await findIcon(host, { ...options, selfHost: req.get("host") });
        remember(host, icon);
      }
      res.setHeader("Cache-Control", `private, max-age=${icon ? FOUND_FOR / 1000 : MISSING_FOR / 1000}`);
      if (!icon) {
        res.status(404).end();
        return;
      }
      res.setHeader("Content-Type", icon.type);
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.end(icon.body);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

async function findIcon(host: string, options: Lookup): Promise<Icon | null> {
  const direct = await fetchIcon(new URL(`https://${host}/favicon.ico`), options);
  if (direct) return direct;
  // Many sites only name their icon in the page head.
  const page = await fetchLimited(new URL(`https://${host}/`), options, MAX_PAGE, "text/html");
  if (!page) return null;
  const href = iconHref(page.body.toString("utf8"));
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, page.url);
  } catch {
    return null;
  }
  return fetchIcon(url, options);
}

async function fetchIcon(url: URL, options: Lookup): Promise<Icon | null> {
  const result = await fetchLimited(url, options, MAX_ICON, "image/*");
  if (!result) return null;
  const type = (result.type.split(";")[0] ?? "").trim().toLowerCase();
  if (!IMAGE_TYPES.has(type) || result.body.length === 0) return null;
  return { type, body: result.body };
}

/** GET with redirects followed by hand, so every hop passes the same SSRF and blocklist checks. */
async function fetchLimited(
  start: URL,
  options: Lookup,
  max: number,
  accept: string,
): Promise<{ url: URL; type: string; body: Buffer } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (options.blocklist?.isBlocked(url.hostname)) return null;
    try {
      validateTarget(url, {
        allowedTestHosts: options.allowedTestHosts,
        selfHost: options.selfHost,
        siteDomain: options.siteDomain,
      });
    } catch {
      return null;
    }
    let response: Dispatcher.ResponseData;
    try {
      response = await request(url, {
        dispatcher: options.agent,
        method: "GET",
        headers: { accept, "user-agent": "Mozilla/5.0 (compatible; Girici)" },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return null;
    }
    const location = response.headers.location;
    if (response.statusCode >= 300 && response.statusCode < 400 && typeof location === "string") {
      await response.body.dump();
      try {
        url = new URL(location, url);
      } catch {
        return null;
      }
      continue;
    }
    if (response.statusCode !== 200) {
      await response.body.dump();
      return null;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    for await (const chunk of response.body) {
      size += (chunk as Buffer).length;
      if (size > max) {
        cut = true;
        break;
      }
      chunks.push(chunk as Buffer);
    }
    if (cut) {
      response.body.destroy();
      // A page's head comes first, so a long page is cut rather than refused.
      if (accept !== "text/html") return null;
    }
    const type = response.headers["content-type"];
    return { url, type: typeof type === "string" ? type : "", body: Buffer.concat(chunks) };
  }
  return null;
}

/** The best icon a page names: an apple-touch-icon is large and never SVG, then any other icon link. */
export function iconHref(html: string): string | null {
  let fallback: string | null = null;
  for (const tag of html.match(ICON_LINK) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.replaceAll("&amp;", "&");
    if (!href || !rel.split(/\s+/).some((word) => word === "icon" || word === "apple-touch-icon")) continue;
    if (/\.svg(?:$|[?#])/i.test(href)) continue;
    if (rel.includes("apple-touch-icon")) return href;
    fallback ??= href;
  }
  return fallback;
}
