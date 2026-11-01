import {
  append,
  apply,
  define,
  now,
  ownValue,
  parseJson,
  promiseThen,
  quoteJson,
  toText,
  urlPart,
} from "../shared/primordials.ts";
import { applyCookieChanges, cookieString, domainMatches, parseScriptCookie } from "../shared/cookie-mirror.ts";
import {
  COOKIE_BATCH_LIMIT,
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

// Taken at load: a window reused for another site keeps these hooks, which then serve that site's cookie calls in the
// realm of the page that made the window.
const ownDescriptor = Object.getOwnPropertyDescriptor;
const NativePromise = Promise;
/** A batch goes out as a promise job on this, so a page's queueMicrotask or then never decides when. */
const loaded = unsteered(NativePromise.resolve());

/** How long a navigation waits for cookie writes, so a worker that never answers cannot hold a click forever. */
export const NAVIGATION_COOKIE_WAIT_MS = 1000;

/** The per-realm cookie mirror state the network and navigation hooks read. */
export interface CookieBridge extends DocumentListeners {
  /** The sequence number of the latest document.cookie write, sent along so the worker can wait for it. */
  currentSeq(): number;
  /** Settles once every write on its way has landed or NAVIGATION_COOKIE_WAIT_MS has passed; null when none is. */
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
  // Writes not sent yet start at `head`; the worker has been sent every seq up to `sentSeq`.
  let queue: string[] = [];
  let head = 0;
  let sentSeq = 0;
  let inflight = false;
  let scheduled = false;
  let waiters: Array<() => void> = [];
  // Captured before the network hooks and storage partitioning wrap these.
  const nativeFetch = win.fetch;
  const nativeSetTimeout = win.setTimeout;
  const responses = win.Response?.prototype;
  const statusOf = responses && (ownDescriptor(responses, "status")?.get as (this: Response) => number);
  const jsonOf = responses && (ownDescriptor(responses, "json")?.value as (this: Response) => Promise<unknown>);
  let nativeSession: Storage | null = null;
  try {
    nativeSession = win.sessionStorage;
  } catch {
    // Blocked storage only disables the reload guard.
  }

  const applyChanges = (changes: readonly CookieSnapshot[]) => {
    if (blocked) return;
    const host = urlPart(ctx.realUrl(), "hostname");
    const mine: CookieSnapshot[] = [];
    for (let index = 0; index < changes.length; index++) {
      const cookie = changes[index] as CookieSnapshot;
      if (domainMatches(host, cookie.domain)) append(mine, cookie);
    }
    mirror = applyCookieChanges(mirror, mine, now());
  };

  const release = () => {
    const released = waiters;
    waiters = [];
    for (let index = 0; index < released.length; index++) (released[index] as () => void)();
  };

  /** One RPC at a time, so the worker applies a page's writes in the order the page made them. */
  const flush = () => {
    scheduled = false;
    if (inflight || head >= queue.length) return;
    const end = queue.length - head > COOKIE_BATCH_LIMIT ? head + COOKIE_BATCH_LIMIT : queue.length;
    // Written out from strings, so a page's JSON.stringify or toJSON never sees the cookie.
    let list = "";
    for (let index = head; index < end; index++) list += (index > head ? "," : "") + quoteJson(queue[index] as string);
    sentSeq += end - head;
    if (end === queue.length) {
      queue = [];
      head = 0;
    } else {
      head = end;
    }
    send(`{"v":${PROTOCOL_VERSION},"seq":${sentSeq},"cookies":[${list}]}`, sentSeq);
  };

  const send = (body: string, batchSeq: number) => {
    inflight = true;
    const batchGeneration = generation;
    const take = (answer: unknown) => {
      const cookies = typeof answer === "object" && answer !== null ? readCookies(ownValue(answer, "cookies")) : null;
      // Writes queued after this batch are already in the mirror, so only the newest batch's answer replaces it.
      if (cookies && batchSeq === seq && batchGeneration === generation) mirror = cookies;
    };
    // Runs on an answer and on a failure alike.
    const done = () => {
      if (batchGeneration !== generation) return;
      inflight = false;
      if (head < queue.length) flush();
      else release();
    };
    let sent: Promise<Response>;
    try {
      sent = apply(nativeFetch, win, [
        ctx.origin + COOKIE_RPC_PATH,
        { __proto__: null, method: "POST", body } as RequestInit,
      ]) as Promise<Response>;
    } catch {
      done();
      return;
    }
    const answered = promiseThen(sent, (response): Promise<void> | undefined => {
      if (apply(statusOf as (this: Response) => number, response, []) === 409) {
        // The worker updated under this page; one reload brings a matching runtime.
        if (nativeSession && allowVersionReload(nativeSession, PROTOCOL_VERSION)) reload();
        return undefined;
      }
      return promiseThen(apply(jsonOf as (this: Response) => Promise<unknown>, response, []), take);
    });
    promiseThen(answered, done, done);
  };

  const write = (text: string) => {
    const cookie = parseScriptCookie(text, ctx.realUrl(), now());
    if (!cookie) return;
    // The worker drops a blocked frame's writes, so the mirror must not show them either.
    if (!blocked) mirror = applyCookieChanges(mirror, [cookie], now());
    seq++;
    append(queue, text);
    // Writes made in one task go out together; writes made while a batch is out wait for the next one.
    if (inflight || scheduled) return;
    scheduled = true;
    promiseThen(loaded, flush);
  };

  define(win.Document.prototype, "cookie", {
    configurable: true,
    enumerable: true,
    get: () => cookieString(mirror, ctx.realUrl(), now()),
    set: (value: unknown) => write(toText(value)),
  });

  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    if (ownValue(data, "type") !== COOKIE_MESSAGE || ownValue(data, "v") !== PROTOCOL_VERSION) return;
    const changes = readCookies(ownValue(data, "changes"));
    if (changes) applyChanges(changes);
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
    pendingWrites: () => {
      if (!inflight && head >= queue.length) return null;
      return unsteered(
        new NativePromise<void>((resolve) => {
          append(waiters, resolve);
          apply(nativeSetTimeout, win, [resolve, NAVIGATION_COOKIE_WAIT_MS]);
        }),
      );
    },
    applySync: (header) => {
      if (!header) return;
      try {
        const changes = readCookies(parseJson(decodeHeaderValue(header)));
        if (changes) applyChanges(changes);
      } catch {
        // A malformed header only costs the mirror one update.
      }
    },
    reset: (next) => {
      mirror = copyCookies(next.cookies);
      blocked = next.cookiesBlocked === true;
      seq = 0;
      generation++;
      // Unsent writes are dropped: the worker would take them as the new document's.
      queue = [];
      head = 0;
      sentSeq = 0;
      inflight = false;
      release();
    },
    snapshot: () => copyCookies(mirror),
  };
}

/** An own `constructor` of undefined makes the captured then build its promise from natives, not the page's species. */
function unsteered<T>(promise: Promise<T>): Promise<T> {
  define(promise, "constructor", { __proto__: null, value: undefined } as PropertyDescriptor);
  return promise;
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
