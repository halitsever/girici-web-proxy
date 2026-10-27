import { applyCookieChanges, cookieString, domainMatches, parseScriptCookie } from "../shared/cookie-mirror.ts";
import {
  BROADCAST_CHANNEL,
  COOKIE_RPC_PATH,
  decodeHeaderValue,
  PROTOCOL_VERSION,
  type ClientConfig,
  type CookieSnapshot,
} from "../shared/protocol.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { allowVersionReload } from "./version.ts";

/** The per-realm cookie mirror state the network and navigation hooks read. */
export interface CookieBridge {
  /** The sequence number of the latest document.cookie write, sent along so the worker can wait for it. */
  currentSeq(): number;
  /** Settles once every cookie write still on its way to the worker has landed; null when none is. */
  pendingWrites(): Promise<void> | null;
  applySync(header: string | null): void;
}

/** document.cookie must answer synchronously, so it reads a local mirror of the worker's jar. */
export function installCookies(win: Realm, ctx: UrlContext, config: ClientConfig): CookieBridge {
  let mirror = [...config.cookies];
  let seq = 0;
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
    mirror = applyCookieChanges(mirror, [cookie], Date.now());
    const mySeq = ++seq;
    inflight++;
    const request = nativeFetch(COOKIE_RPC_PATH, {
      method: "POST",
      body: JSON.stringify({ v: PROTOCOL_VERSION, seq: mySeq, cookie: text }),
    })
      .then(async (response) => {
        if (response.status === 409) {
          // The worker updated under this page; one reload brings a matching runtime.
          if (nativeSession && allowVersionReload(nativeSession, PROTOCOL_VERSION)) win.location.reload();
          return;
        }
        const body = (await response.json()) as { cookies?: CookieSnapshot[] };
        // A newer write may already be in the mirror, so only the latest answer replaces it.
        if (Array.isArray(body.cookies) && mySeq === seq) mirror = body.cookies;
      })
      .catch(() => {})
      .finally(() => {
        inflight--;
        if (inflight === 0) pending = null;
      });
    pending = pending ? Promise.all([pending, request]).then(() => {}) : request;
  };

  Object.defineProperty(win.Document.prototype, "cookie", {
    configurable: true,
    enumerable: true,
    get: () => cookieString(mirror, ctx.realUrl(), Date.now()),
    set: (value: unknown) => write(String(value)),
  });

  try {
    const channel = new win.BroadcastChannel(BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ type?: unknown; v?: unknown; changes?: unknown }>) => {
      const { type, v, changes } = event.data ?? {};
      if (type === "cookies" && v === PROTOCOL_VERSION && Array.isArray(changes)) apply(changes as CookieSnapshot[]);
    };
  } catch {
    // Without BroadcastChannel only other tabs' changes are missed.
  }

  return {
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
  };
}
