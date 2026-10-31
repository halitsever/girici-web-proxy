import { define } from "../shared/primordials.ts";
import { applyCookieChanges, cookieString, domainMatches, parseScriptCookie } from "../shared/cookie-mirror.ts";
import {
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  decodeHeaderValue,
  PROTOCOL_VERSION,
  type ClientConfig,
  type CookieSnapshot,
} from "../shared/protocol.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { allowVersionReload } from "./version.ts";

/** The per-realm cookie mirror state the network and navigation hooks read. */
export interface CookieBridge extends DocumentListeners {
  /** The sequence number of the latest document.cookie write, sent along so the worker can wait for it. */
  currentSeq(): number;
  /** Settles once every cookie write still on its way to the worker has landed; null when none is. */
  pendingWrites(): Promise<void> | null;
  applySync(header: string | null): void;
  /** A reused window starts over from the new document's config; the service worker sees a new client. */
  reset(config: ClientConfig): void;
  snapshot(): CookieSnapshot[];
}

/** document.cookie must answer synchronously, so it reads a local mirror of the worker's jar. */
export function installCookies(
  win: Realm,
  ctx: UrlContext,
  config: ClientConfig,
  container: () => ServiceWorkerContainer | null,
  reload: () => void,
): CookieBridge {
  let mirror = [...config.cookies];
  let blocked = config.cookiesBlocked === true;
  let seq = 0;
  // Answers to the previous document's writes must not land in the renewed document's mirror.
  let generation = 0;
  let inflight = 0;
  let pending: Promise<void> | null = null;
  // Captured before the network hooks and storage partitioning wrap these.
  const nativeFetch = win.fetch.bind(win);
  let nativeSession: Storage | null = null;
  try {
    nativeSession = win.sessionStorage;
  } catch {
    // Blocked storage only disables the reload guard.
  }

  const apply = (changes: CookieSnapshot[]) => {
    if (blocked) return;
    const host = ctx.realUrl().hostname;
    mirror = applyCookieChanges(
      mirror,
      changes.filter((cookie) => domainMatches(host, cookie.domain)),
      Date.now(),
    );
  };

  const write = (text: string) => {
    const cookie = parseScriptCookie(text, ctx.realUrl(), Date.now());
    if (!cookie) return;
    // The worker drops a blocked frame's writes, so the mirror must not show them either.
    if (!blocked) mirror = applyCookieChanges(mirror, [cookie], Date.now());
    const mySeq = ++seq;
    const myGeneration = generation;
    inflight++;
    const request = nativeFetch(ctx.origin + COOKIE_RPC_PATH, {
      method: "POST",
      body: JSON.stringify({ v: PROTOCOL_VERSION, seq: mySeq, cookie: text }),
    })
      .then(async (response) => {
        if (response.status === 409) {
          // The worker updated under this page; one reload brings a matching runtime.
          if (nativeSession && allowVersionReload(nativeSession, PROTOCOL_VERSION)) reload();
          return;
        }
        const body = (await response.json()) as { cookies?: CookieSnapshot[] };
        // A newer write may already be in the mirror, so only the latest answer replaces it.
        if (Array.isArray(body.cookies) && mySeq === seq && myGeneration === generation) mirror = body.cookies;
      })
      .catch(() => {})
      .finally(() => {
        inflight--;
        if (inflight === 0) pending = null;
      });
    pending = pending ? Promise.all([pending, request]).then(() => {}) : request;
  };

  define(win.Document.prototype, "cookie", {
    configurable: true,
    enumerable: true,
    get: () => cookieString(mirror, ctx.realUrl(), Date.now()),
    set: (value: unknown) => write(String(value)),
  });

  const onMessage = (event: MessageEvent<{ type?: unknown; v?: unknown; changes?: unknown }>) => {
    const { type, v, changes } = event.data ?? {};
    if (type === COOKIE_MESSAGE && v === PROTOCOL_VERSION && Array.isArray(changes)) apply(changes as CookieSnapshot[]);
  };
  const listen = () => {
    const current = container();
    if (!current) return;
    current.addEventListener("message", onMessage);
    // Messages wait in a queue until this runs.
    current.startMessages();
  };
  listen();

  return {
    listen,
    currentSeq: () => seq,
    pendingWrites: () => pending,
    applySync: (header) => {
      if (!header) return;
      try {
        apply(JSON.parse(decodeHeaderValue(header)) as CookieSnapshot[]);
      } catch {
        // A malformed header only costs the mirror one update.
      }
    },
    reset: (next) => {
      mirror = [...next.cookies];
      blocked = next.cookiesBlocked === true;
      seq = 0;
      generation++;
    },
    snapshot: () => [...mirror],
  };
}
