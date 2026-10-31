import { append, define, ownValue, parseJson, quoteJson, toText } from "../shared/primordials.ts";
import { applyCookieChanges, cookieString, domainMatches, parseScriptCookie } from "../shared/cookie-mirror.ts";
import {
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  decodeHeaderValue,
  PROTOCOL_VERSION,
  type ClientConfig,
  type CookieSnapshot,
} from "../shared/protocol.ts";
import { readCookies } from "./config.ts";
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
  let mirror = copyCookies(config.cookies);
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
    // Written out from strings, so a page's JSON.stringify or toJSON never sees the cookie.
    const request = nativeFetch(ctx.origin + COOKIE_RPC_PATH, {
      __proto__: null,
      method: "POST",
      body: `{"v":${PROTOCOL_VERSION},"seq":${mySeq},"cookie":${quoteJson(text)}}`,
    } as RequestInit)
      .then(async (response) => {
        if (response.status === 409) {
          // The worker updated under this page; one reload brings a matching runtime.
          if (nativeSession && allowVersionReload(nativeSession, PROTOCOL_VERSION)) reload();
          return;
        }
        const body: unknown = await response.json();
        const cookies = typeof body === "object" && body !== null ? readCookies(ownValue(body, "cookies")) : null;
        // A newer write may already be in the mirror, so only the latest answer replaces it.
        if (cookies && mySeq === seq && myGeneration === generation) mirror = cookies;
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
    set: (value: unknown) => write(toText(value)),
  });

  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    if (ownValue(data, "type") !== COOKIE_MESSAGE || ownValue(data, "v") !== PROTOCOL_VERSION) return;
    const changes = readCookies(ownValue(data, "changes"));
    if (changes) apply(changes);
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
        const changes = readCookies(parseJson(decodeHeaderValue(header)));
        if (changes) apply(changes);
      } catch {
        // A malformed header only costs the mirror one update.
      }
    },
    reset: (next) => {
      mirror = copyCookies(next.cookies);
      blocked = next.cookiesBlocked === true;
      seq = 0;
      generation++;
    },
    snapshot: () => copyCookies(mirror),
  };
}

/** Indexed copies with null prototypes: snapshots go into frames' configs, which page code must not steer. */
function copyCookies(cookies: readonly CookieSnapshot[]): CookieSnapshot[] {
  const copy: CookieSnapshot[] = [];
  for (let index = 0; index < cookies.length; index++) {
    const cookie = cookies[index] as CookieSnapshot;
    append(copy, {
      __proto__: null,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: cookie.hostOnly,
      secure: cookie.secure,
      expires: cookie.expires,
      creation: cookie.creation,
    } as CookieSnapshot);
  }
  return copy;
}
