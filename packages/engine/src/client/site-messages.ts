import { apply, define, isWebUrl, NativeWeakMap, originOf, parseUrl, toText } from "../shared/primordials.ts";
import type { MessageEnvelope, SiteContext } from "../shared/protocol.ts";
import { readMessageEnvelope } from "../shared/site-config.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentListeners } from "./renewal.ts";
import { createLabelLookup, createSiteLabels, type SiteLabels } from "./site-labels.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** A message whose receiver's host is still unknown after this long is dropped, so later ones are not held up. */
export const CROSS_SITE_TIMEOUT_MS = 2000;

/** Posts `message` to a window on another site host, as `target.postMessage(message, targetOrigin, ...rest)`. */
export type CrossSitePost = (target: object, message: unknown, targetOrigin: unknown, rest: unknown[]) => void;

// Taken at load: posting and the event getters run inside page calls, after page code may have replaced these.
const ownDescriptor = Object.getOwnPropertyDescriptor;
const promiseThen = Promise.prototype.then;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakHas = WeakMap.prototype.has;

interface Queued {
  target: object;
  args: unknown[] | null;
  waiting: boolean;
  next: Queued | null;
}

type Verified = NonNullable<ReturnType<SiteLabels["verify"]>>;

/** Labels and the site poster of a document on a site host, from natives taken before the runtime's hooks. */
export function createSiteMessaging(
  win: Realm,
  ctx: UrlContext,
  invoke: Invoke,
  sites: SiteContext | undefined,
): { labels: SiteLabels; post: CrossSitePost } | null {
  if (!sites) return null;
  const fetch = win.fetch;
  const setTimer = win.setTimeout;
  const lookup = createLabelLookup((url, init) => apply(fetch, win, [url, init]) as Promise<Response>, ctx.origin);
  const labels = createSiteLabels(sites, () => originOf(ctx.realUrl()), lookup);
  const timer = ((handler: () => void, delay: number) => apply(setTimer, win, [handler, delay])) as typeof setTimeout;
  return { __proto__: null, labels, post: createCrossSitePoster(labels, invoke, win.postMessage, timer) } as never;
}

/**
 * Another host's window takes the message only with that host as its target origin, so each message waits for its
 * receiver's host in one queue that keeps the order of calls. The real target travels in the envelope.
 */
export function createCrossSitePoster(
  labels: SiteLabels,
  invoke: Invoke,
  nativePost: Window["postMessage"],
  setTimer: typeof setTimeout,
): CrossSitePost {
  let first: Queued | null = null;
  let last: Queued | null = null;

  const drain = () => {
    while (first && !first.waiting) {
      const entry: Queued = first;
      first = entry.next;
      if (!first) last = null;
      try {
        if (entry.args) invoke(nativePost, entry.target, entry.args);
      } catch {
        // A message the browser cannot clone is lost, as it would be natively, and the rest still go.
      }
    }
  };
  const enqueue = (target: object, args: unknown[] | null, waiting: boolean): Queued => {
    const entry: Queued = { __proto__: null, target, args, waiting, next: null } as Queued;
    if (last) last.next = entry;
    else first = entry;
    last = entry;
    return entry;
  };

  return (target, message, targetOrigin, rest) => {
    const options = typeof targetOrigin === "object" && targetOrigin !== null ? targetOrigin : null;
    const wanted = options ? (options as { targetOrigin?: unknown }).targetOrigin : targetOrigin;
    // A missing target means "/", the sender's own origin, which another host never is.
    const text = wanted === undefined ? "/" : toText(wanted);
    if (text === "/") return;
    const transfer = options ? (options as { transfer?: unknown }).transfer : rest.length ? rest[0] : undefined;
    const argsFor = (host: string, envelope: MessageEnvelope): unknown[] => {
      if (options) {
        const init = { __proto__: null, targetOrigin: host } as { targetOrigin: string; transfer?: unknown };
        if (transfer !== undefined) init.transfer = transfer;
        return [envelope, init];
      }
      return rest.length ? [envelope, host, transfer] : [envelope, host];
    };
    if (text === "*") {
      const args = argsFor("*", labels.envelope(message, "*"));
      if (first) enqueue(target, args, false);
      else invoke(nativePost, target, args);
      return;
    }
    const url = parseUrl(text);
    // The browser refuses a target that is no URL, and the caller sees its error.
    if (!url) return void invoke(nativePost, target, argsFor(text, labels.envelope(message, text)));
    if (!isWebUrl(url)) return;
    const real = originOf(url);
    const envelope = labels.envelope(message, real);
    const known = labels.hostOf(real);
    if (known !== null && !first) return void invoke(nativePost, target, argsFor(known, envelope));
    const entry = enqueue(target, null, true);
    const settle = (host: unknown) => {
      if (!entry.waiting) return;
      entry.waiting = false;
      if (typeof host === "string") entry.args = argsFor(host, envelope);
      drain();
    };
    setTimer(() => settle(null), CROSS_SITE_TIMEOUT_MS);
    apply(promiseThen, labels.resolve(real), [settle, () => settle(null)]);
  };
}

/**
 * Hooks `MessageEvent.prototype.data` and returns what the origin getter reports for a message from another site
 * host: the envelope's real origin once it checks out, else "null" so origin checks fail closed. The listener stops a
 * forged or misaddressed envelope before any page listener.
 */
export function installSiteMessages(
  win: Realm,
  ctx: UrlContext,
  labels: SiteLabels,
): DocumentListeners & { origin(event: object, nativeOrigin: string): string | undefined } {
  const proto = win.MessageEvent.prototype;
  const nativeOrigin = ownDescriptor(proto, "origin")?.get;
  const dataDescriptor = ownDescriptor(proto, "data");
  const nativeData = dataDescriptor?.get;
  const stop = win.Event.prototype.stopImmediatePropagation;
  const addListener = win.addEventListener;
  const checked = new NativeWeakMap<object, Verified | null>();

  /** Undefined for any event that is not a trusted message from another site host. */
  const check = (event: object, origin: string): Verified | null | undefined => {
    // isTrusted is an own, unforgeable property; an event the page made itself stays as it made it.
    if ((event as Event).isTrusted !== true || !nativeData || !labels.isOtherSiteHost(origin)) return undefined;
    if (apply(weakHas, checked, [event])) return apply(weakGet, checked, [event]) as Verified | null;
    const verified = labels.verify(origin, apply(nativeData, event, []));
    apply(weakSet, checked, [event, verified]);
    return verified;
  };

  if (dataDescriptor && nativeData && nativeOrigin) {
    define(proto, "data", {
      ...dataDescriptor,
      get: maskNative(function (this: MessageEvent) {
        const data: unknown = apply(nativeData, this, []);
        const verified = check(this, toText(apply(nativeOrigin, this, [])));
        return verified ? verified.data : data;
      }, nativeData),
    });
  }

  const drop = (event: Event) => {
    try {
      if (event.isTrusted !== true || !nativeOrigin || !nativeData) return;
      const verified = check(event, toText(apply(nativeOrigin, event, [])));
      if (verified === undefined) return;
      const misaddressed = verified
        ? verified.target !== "*" && verified.target !== originOf(ctx.realUrl())
        : readMessageEnvelope(apply(nativeData, event, [])) !== null;
      if (misaddressed) apply(stop, event, []);
    } catch {
      // Only a message event has these getters; anything else passes as it came.
    }
  };

  return {
    __proto__: null,
    origin: (event, origin) => {
      const verified = check(event, origin);
      return verified === undefined ? undefined : (verified?.origin ?? "null");
    },
    // Capture on the window, added before any page listener, so it runs first.
    listen: () => apply(addListener, win, ["message", drop, true]),
  } as DocumentListeners & { origin(event: object, nativeOrigin: string): string | undefined };
}
