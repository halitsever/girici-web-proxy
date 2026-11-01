import { charCodeAt, exec, fromBase64, newBytes, replaceAll, strictUtf8 } from "./primordials.ts";
import type { SearchEngine } from "./target.ts";

export const HEADER = {
  relay: "x-girici-relay",
  method: "x-girici-method",
  headers: "x-girici-headers",
  origin: "x-girici-origin",
  referer: "x-girici-referer",
  fetch: "x-girici-fetch",
  status: "x-girici-status",
  setCookie: "x-girici-set-cookie",
  error: "x-girici-error",
  cookie: "x-girici-cookie",
  cookieSeq: "x-girici-cseq",
  cookieSync: "x-girici-cookie-sync",
} as const;

/** Bumped whenever the runtime and the service worker stop understanding each other's messages. */
export const PROTOCOL_VERSION = 2;
export const COOKIE_RPC_PATH = "/_g/rpc/cookie";
/** The most script cookie writes one RPC carries; the worker refuses a longer batch. */
export const COOKIE_BATCH_LIMIT = 50;
export const WS_PREP_PATH = "/_g/rpc/ws-prep";
export const SITE_DATA_RPC_PATH = "/_g/rpc/site-data";
/** A page announces each worker it starts here; the worker names the same nonce when it loads the runtime. */
export const WORKER_RPC_PATH = "/_g/rpc/worker";
export const WORKER_NONCE_PARAM = "n";
/** A SharedWorker's script address, which tabs of one site share so the browser joins them to one instance. */
export const SHARED_WORKER_PATH = "/_g/rpc/shared-worker";
// Only the service worker calls these two; pages never need them.
export const POT_PATH = "/_g/pot";
export const WS_SEAL_PATH = "/_g/ws-seal";
export const PREFS_MESSAGE = "girici:prefs";
export const TOP_SITE_QUERY = "girici:top?";
export const COOKIE_MESSAGE = "girici:cookies";
// Under /_g/ so the service worker passes them through instead of re-encoding them as proxy targets.
export const LOGIN_PATH = "/_g/login";
export const SETUP_PATH = "/_g/setup";
/** The browser check page; a UI route, so the worker lets its window call the check API. */
export const CHALLENGE_PATH = "/_g/challenge";
export const POW_PATH = "/_g/pow";
/** The shared-link warning posts here; the service worker answers it and the server never sees it. */
export const CONTINUE_PATH = "/_g/rpc/continue";
/** Outside /_g/, so a proxied page's own /metrics stays the site's; the worker keeps browsers away from ours. */
export const METRICS_PATH = "/metrics";

// Subdomain mode. The root takes the UI's settings and runs the site list and the clearing chain.
export const PREFS_PATH = "/_g/prefs";
export const SITES_LIST_PATH = "/_g/sites/list";
export const SITES_PLAN_PATH = "/_g/sites/plan";
export const SITES_DONE_PATH = "/_g/sites/done";
/** The root sends the clearing chain back to `/settings?cleared=<n>`. */
export const SITES_CLEARED_PARAM = "cleared";
// Each site host answers its own config and clears its own data; no route is shared through CORS.
export const SITES_CONFIG_PATH = "/_g/sites/config";
export const SITES_CLEAR_PATH = "/_g/sites/clear";
/** A page asks its own service worker which host serves a real origin; `LABEL_RPC_LIMIT` origins per call at most. */
export const LABEL_RPC_PATH = "/_g/rpc/label";
export const LABEL_RPC_LIMIT = 16;

/** Marks a message that crossed site hosts; the NUL keeps it from clashing with a page's own field names. */
export const MESSAGE_ENVELOPE = "\u0000girici" as const;

/** What `postMessage` sends to a window on another site host, so the receiver can see the real origins. */
export interface MessageEnvelope {
  [MESSAGE_ENVELOPE]: 1;
  /** The sender's real origin. */
  o: string;
  /** The sender's schemeful site, which the receiver checks against the sender's host label. */
  s: string;
  /** The real target origin the page asked for, or "*". */
  t: string;
  d: unknown;
}

/** The UI's engine settings as the root keeps them in a signed cookie for every site host. */
export interface SitePrefs {
  blockThirdPartyCookies: boolean;
  sealAddresses: boolean;
  toolbar: boolean;
  engine: SearchEngine;
}

export const DEFAULT_SITE_PREFS: SitePrefs = {
  blockThirdPartyCookies: true,
  sealAddresses: false,
  toolbar: true,
  engine: "DuckDuckGo",
};

/** The answer to `GET` and `POST` on `SITES_CONFIG_PATH`. */
export interface SiteConfigAnswer {
  v: 1;
  /** The site domain's `value`, port included. */
  domain: string;
  /** This host's own label. */
  label: string;
  /** base64url of the label key; null until the gate would let the caller browse. */
  key: string | null;
  prefs: SitePrefs;
  instanceSeal: boolean;
  /** The shared-link warning switch; false on a private instance, which lets no visitor in. */
  deepLinkWarning: boolean;
}

/** `POST` body on `SITES_CONFIG_PATH`, as JSON: the worker names the site it serves so the root can list it. */
export interface SiteReport {
  site: string;
}

/** A site-host document's view of subdomain mode, written by its service worker. */
export interface SiteContext {
  /** The site domain's `value`. */
  domain: string;
  /** The root's origin, such as `https://proxy.example`. */
  root: string;
  label: string;
  /** base64url of the label key. */
  key: string;
  /** The schemeful site this host serves. */
  site: string;
  toolbar: boolean;
  engine: SearchEngine;
}

/** `POST` body on `LABEL_RPC_PATH`, as JSON; `v` is `PROTOCOL_VERSION`. */
export interface LabelRequest {
  v: number;
  origins: string[];
}

/** One `[origin, host origin]` pair per asked origin, in order; null where no host can be named. */
export interface LabelAnswer {
  hosts: Array<[string, string | null]>;
}

/** `GET` on `SITES_LIST_PATH`: the sites this browser visited, newest first. */
export interface SiteListAnswer {
  sites: Array<{ site: string; host: string }>;
}

/** `POST` body on `SITES_PLAN_PATH`, as JSON. */
export interface SitePlanRequest {
  sites: string[] | "all";
}

/** `start` is the first hop of the clearing chain, a scheme-relative URL the UI assigns. */
export interface SitePlanAnswer {
  start: string;
}

/** The service worker's answer to a page's `clear`; `all` means it cleared the whole host, not only `site`. */
export interface SiteDataClearAnswer {
  site: string;
  cookies: number;
  all?: true;
}

/** A cookie as page scripts may see it; times are epoch milliseconds and a null expiry marks a session cookie. */
export interface CookieSnapshot {
  name: string;
  value: string;
  domain: string;
  path: string;
  hostOnly: boolean;
  secure: boolean;
  expires: number | null;
  creation: number;
}

/** Settings the service worker needs but cannot read from the UI's localStorage. */
export interface EnginePrefs {
  blockThirdPartyCookies: boolean;
  /** This browser's own switch for sealed page addresses. */
  sealAddresses: boolean;
  /** The admin's switch, which turns sealing on for every visitor. */
  instanceSeal: boolean;
  /** Set once this browser has opened Girici itself, after which shared links skip the warning. */
  seen: boolean;
}

export const DEFAULT_ENGINE_PREFS: EnginePrefs = {
  blockThirdPartyCookies: true,
  sealAddresses: false,
  instanceSeal: false,
  seen: false,
};

/** The UI asks the service worker for a page's sealed address; the UI never holds the key. */
export const SEAL_MESSAGE = "girici:seal";

/** One registrable domain's stored data, as the Settings screen lists it. */
export interface SiteSummary {
  site: string;
  cookies: number;
  origins: string[];
}

export type SiteDataRequest =
  | { v: number; op: "list"; origins: string[] }
  | { v: number; op: "clear"; site?: string }
  | { v: number; op: "clear-all" };

/** What a blank or srcdoc frame inherits from its parent, since its own origin is opaque and it has no proxy URL. */
export interface InheritedContext {
  /** The proxy origin. */
  origin: string;
  /** The real URL of the parent page. */
  base: string;
  /** Set for a blob document's bootstrap: the blob the runtime loads once it is in place. */
  blob?: string;
}

/** A sealed document's own origin and its key, base64url; it seals and opens that origin's addresses only. */
export interface OriginSeal {
  origin: string;
  label: string;
  key: string;
}

export interface ClientConfig {
  v: number;
  cookies: CookieSnapshot[];
  /** Set for frames and documents that cannot derive their context from their own address. */
  inherit?: InheritedContext;
  /** The page's registrable site, for storage partitioning. */
  site?: string;
  /** Set for a third-party frame while blocking is on: its document.cookie stays empty whatever other tabs do. */
  cookiesBlocked?: boolean;
  /** Set for a top-level document on a sealed address. */
  seal?: OriginSeal;
  /** Set for every document on a site host in subdomain mode. */
  sites?: SiteContext;
}

export type RelayErrorCode =
  | "bad_request"
  | "ssrf_blocked"
  | "dns"
  | "connect"
  | "tls"
  | "timeout"
  | "too_large"
  | "header_overflow"
  | "auth"
  | "rate_limited"
  | "blocked"
  | "proxy"
  | "quota"
  | "challenge";

/** base64url keeps any bytes, such as non-ASCII cookie values, legal inside an HTTP header. */
export function encodeHeaderValue(value: string): string {
  let binary = "";
  const bytes = new TextEncoder().encode(value);
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index] as number);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const URL_SAFE_CHARS = /[-_]/g;
const NativeTypeError = TypeError;

/** Natives taken at load only, since this runs inside page calls. */
export function decodeHeaderValue(value: string): string {
  if (exec(BASE64URL, value) === null) throw new NativeTypeError("Header value is not base64url");
  let base64 = replaceAll(value, URL_SAFE_CHARS, (char) => (char === "-" ? "+" : "/"));
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = fromBase64(base64);
  const bytes = newBytes(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = charCodeAt(binary, index);
  return strictUtf8(bytes);
}

export function encodeHeaderList(pairs: ReadonlyArray<readonly [string, string]>): string {
  return encodeHeaderValue(JSON.stringify(pairs));
}

export function decodeHeaderList(value: string): Array<[string, string]> {
  const parsed: unknown = JSON.parse(decodeHeaderValue(value));
  if (!Array.isArray(parsed) || !parsed.every(isPair)) throw new TypeError("Header list is malformed");
  return parsed;
}

function isPair(item: unknown): item is [string, string] {
  return Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string";
}
