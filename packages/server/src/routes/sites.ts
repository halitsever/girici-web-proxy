import {
  decodeUrl,
  encodeUrl,
  isSealedPath,
  LOGIN_PATH,
  PREFS_PATH,
  readSitePrefs,
  SITES_CLEAR_PATH,
  SITES_CLEARED_PARAM,
  SITES_CONFIG_PATH,
  SITES_DONE_PATH,
  SITES_LIST_PATH,
  SITES_PLAN_PATH,
  siteLabel,
  type SiteConfigAnswer,
  type SiteListAnswer,
  type SitePlanAnswer,
} from "@girici/engine/shared";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { addSiteSession, isAdminCookie, siteSessionAdmin } from "../auth/gate.ts";
import type { AuthStore } from "../auth/store.ts";
import { isOwnHost } from "../http/origin.ts";
import { clearPage, openPlan, PLAN_TTL_MS, signPlan, type ClearPlan } from "../sites/clear.ts";
import { readPrefsCookie, readVisited, rememberSite, signPrefs, signVisited, siteCookie } from "../sites/cookies.ts";
import { requestHost, siteHostFor } from "../sites/hosts.ts";
import type { SiteSetup } from "../sites/keys.ts";

export const SEALED_GONE =
  "Addresses encrypted before this server moved sites to their own addresses do not open any more. " +
  "Open the site again from Girici.";

/** Takes over a root worker left from single-origin mode and removes it, so the root never proxies. */
export const RETIRE_WORKER =
  'self.addEventListener("install",()=>self.skipWaiting());' +
  'self.addEventListener("activate",(e)=>e.waitUntil(self.registration.unregister()));';

const INERT_CSP = "sandbox; default-src 'none'";
const CLEAR_CSP = "default-src 'none'; frame-ancestors 'none'";

/** The root serves the UI only; proxy addresses typed or bookmarked there move to their site's host. */
export function siteRootRouter(setup: SiteSetup, store: AuthStore): Router {
  const router = Router({ caseSensitive: true, strict: true });
  const { domain, keys } = setup;

  router.use("/~", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    // Each site host seals with its own key, so nothing here can open these.
    if (isSealedPath(req.originalUrl)) {
      sendInert(res, 404, SEALED_GONE);
      return;
    }
    const target = decodeUrl(req.originalUrl);
    if (!target) {
      sendInert(res, 400, "Bad Request");
      return;
    }
    // Signed-out visitors of a private instance learn no site hosts from here.
    if (!store.publicAccess() && !isAdminCookie(store, req.headers.cookie)) {
      res.redirect(302, `${LOGIN_PATH}?next=${encodeURIComponent(target.href)}`);
      return;
    }
    // The site host's relay needs the site session, which an admin signed in before subdomain mode lacks.
    addSiteSession(req, res, store, domain);
    // Scheme-relative, so the site host opens on the scheme the page used.
    res.redirect(302, `//${siteHostFor(target, setup)}${encodeUrl(target)}`);
  });

  router.get("/_g/sw.js", (_req, res) => {
    res.set({
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      // The old registration's scope is "/", and an update that may not keep it fails and leaves the worker running.
      "Service-Worker-Allowed": "/",
    });
    res.send(RETIRE_WORKER);
  });

  // The UI keeps its settings in its own storage and copies the engine's share here for the site hosts.
  router.post(PREFS_PATH, ownOrigin, express.json({ limit: "1kb" }), (req, res) => {
    if (!isPlainObject(req.body)) {
      res.status(400).end();
      return;
    }
    res.setHeader("Set-Cookie", siteCookie("prefs", signPrefs(readSitePrefs(req.body), keys), domain, isHttps(req)));
    res.status(204).end();
  });

  router.get(SITES_LIST_PATH, (req, res) => {
    const sites = readVisited(req.headers.cookie, keys).map((site) => ({ site, host: hostOfSite(site, setup) }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ sites } satisfies SiteListAnswer);
  });

  router.post(SITES_PLAN_PATH, ownOrigin, express.json({ limit: "8kb" }), (req, res) => {
    const wanted = (req.body as { sites?: unknown } | undefined)?.sites;
    if (wanted !== "all" && !(Array.isArray(wanted) && wanted.every((site) => typeof site === "string"))) {
      res.status(400).end();
      return;
    }
    const visited = readVisited(req.headers.cookie, keys);
    // Only listed sites: a plan names hosts this browser has used, nothing else.
    const sites = wanted === "all" ? visited : visited.filter((site) => wanted.includes(site));
    const plan: ClearPlan = {
      labels: sites.map((site) => siteLabel(keys.label, site)),
      sites,
      https: isHttps(req),
      exp: Date.now() + PLAN_TTL_MS,
    };
    const signed = signPlan(plan, keys);
    res.setHeader("Cache-Control", "no-store");
    res.json({ start: hopAfter(plan, signed, -1, setup) } satisfies SitePlanAnswer);
  });

  router.get(SITES_DONE_PATH, (req, res) => {
    const plan = planOf(req, setup);
    if (!plan) {
      res.status(403).end();
      return;
    }
    const left = readVisited(req.headers.cookie, keys).filter((site) => !plan.sites.includes(site));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", siteCookie("sites", signVisited(left, keys), domain, plan.https));
    res.redirect(302, `/settings?${SITES_CLEARED_PARAM}=${plan.sites.length}`);
  });

  return router;
}

/** Site hosts serve the engine and their own site; everything for people lives on the root. */
export function siteHostRouter(setup: SiteSetup, store: AuthStore): Router {
  const router = Router({ caseSensitive: true, strict: true });
  const { domain, keys } = setup;

  router.get("/", (_req, res) => {
    res.redirect(302, `//${domain.value}/`);
  });

  /** The worker's config; the key goes only to callers the gate would let browse. */
  const config = (req: Request, res: Response): SiteConfigAnswer => {
    const host = requestHost(res);
    const browse = store.publicAccess() || siteSessionAdmin(store, req.headers.cookie) !== null;
    return {
      v: 1,
      domain: domain.value,
      label: host.kind === "site" ? host.label : "",
      key: browse ? Buffer.from(keys.label).toString("base64url") : null,
      prefs: { ...readPrefsCookie(req.headers.cookie, keys) },
      instanceSeal: store.sealAddresses(),
    };
  };
  const answer = (res: Response, body: SiteConfigAnswer) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "Cookie");
    res.json(body);
  };

  router.get(SITES_CONFIG_PATH, (req, res) => {
    answer(res, config(req, res));
  });

  // The worker names its site once; the label check keeps a host from listing any site but its own.
  router.post(SITES_CONFIG_PATH, ownOrigin, express.json({ limit: "1kb" }), (req, res) => {
    const body = config(req, res);
    const site = (req.body as { site?: unknown } | undefined)?.site;
    if (body.key !== null && typeof site === "string" && siteLabel(keys.label, site) === body.label) {
      const visited = rememberSite(readVisited(req.headers.cookie, keys), site);
      res.setHeader("Set-Cookie", siteCookie("sites", signVisited(visited, keys), domain, isHttps(req)));
    }
    answer(res, body);
  });

  router.get(SITES_CLEAR_PATH, (req, res) => {
    const host = requestHost(res);
    const plan = planOf(req, setup);
    const index = typeof req.query.i === "string" && /^\d{1,4}$/.test(req.query.i) ? Number(req.query.i) : -1;
    if (!plan || host.kind !== "site" || plan.labels[index] !== host.label) {
      res.status(403).end();
      return;
    }
    // Never "cookies": that would clear the whole domain, sessions and settings included.
    res.set({
      "Clear-Site-Data": '"cache", "storage"',
      "Content-Security-Policy": CLEAR_CSP,
      "Cache-Control": "no-store",
    });
    res.type("html").send(clearPage(hopAfter(plan, signedQuery(req), index, setup)));
  });

  return router;
}

/** The hop after `index`: the next host's clear page, or the root's done page after the last one. */
function hopAfter(plan: ClearPlan, signed: string, index: number, setup: SiteSetup): string {
  const next = plan.labels[index + 1];
  if (next === undefined) return `//${setup.domain.value}${SITES_DONE_PATH}?${signed}`;
  return `//${next}.${setup.domain.value}${SITES_CLEAR_PATH}?${signed}&i=${index + 1}`;
}

function planOf(req: Request, setup: SiteSetup): ClearPlan | null {
  const { p, s } = req.query;
  return typeof p === "string" && typeof s === "string" ? openPlan(p, s, setup.keys) : null;
}

/** The plan's own `p` and `s`, already checked, so they pass on unchanged. */
function signedQuery(req: Request): string {
  return `p=${String(req.query.p)}&s=${String(req.query.s)}`;
}

function hostOfSite(site: string, setup: SiteSetup): string {
  return `${siteLabel(setup.keys.label, site)}.${setup.domain.value}`;
}

function ownOrigin(req: Request, res: Response, next: NextFunction): void {
  if (isOwnHost(req.get("origin"), req.headers.host)) next();
  else res.status(403).end();
}

/** The page's own scheme, from the Origin these same-origin POSTs carry; a TLS terminator hides it from req. */
function isHttps(req: Request): boolean {
  return URL.parse(req.get("origin") ?? "")?.protocol === "https:";
}

function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendInert(res: Response, status: number, text: string): void {
  res.setHeader("Content-Security-Policy", INERT_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(status).type("text/plain").send(text);
}
