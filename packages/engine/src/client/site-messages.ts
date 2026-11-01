import { apply, define, isWebUrl, NativeWeakMap, originOf, parseUrl, toText } from "../shared/primordials.ts";
import type { MessageEnvelope, SiteContext } from "../shared/protocol.ts";
import { readMessageEnvelope } from "../shared/site-config.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentListeners } from "./renewal.ts";
import {
  createLabelLookup,
  createSiteLabels,
  type LabelLookup,
  type SiteClaim,
  type SiteLabels,
} from "./site-labels.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** A message whose host lookup has not settled after this long is dropped, so later ones are not held up. */
export const CROSS_SITE_TIMEOUT_MS = 2000;

/** Posts `message` to a window on another site host, as `target.postMessage(message, targetOrigin, ...rest)`. */
export type CrossSitePost = (target: object, message: unknown, targetOrigin: unknown, rest: unknown[]) => void;

// Taken at load: posting and the event getters run inside page calls, after page code may have replaced these.
const ownDescriptor = Object.getOwnPropertyDescriptor;
const promiseThen = Promise.prototype.then;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakHas = WeakMap.prototype.has;

interface Job {
  run: (() => void) | null;
  waiting: boolean;
  next: Job | null;
}

/** A checked message; `origin` is undefined where the native origin stands. */
type Verified = Omit<SiteClaim, "origin" | "host"> & { origin?: string; host?: string };

export type { LabelLookup };

/** Runs jobs in the order they came, each once the host lookup it waits for settles or times out. */
function createOrderedQueue(setTimer: typeof setTimeout) {
  let first: Job | null = null;
  let last: Job | null = null;
  const drain = () => {
    while (first && !first.waiting) {
      const job: Job = first;
      first = job.next;
      if (!first) last = null;
      try {
        job.run?.();
      } catch {
        // One message the browser refuses is lost, as it would be natively, and the rest still go.
      }
    }
  };
  const add = (run: (() => void) | null, waiting: boolean): Job => {
    // Only this queue reads its jobs, and every field it reads is the job's own.
    const job: Job = { run, waiting, next: null };
    if (last) last.next = job;
    else first = job;
    last = job;
    return job;
  };
  return {
    busy: () => !!first,
    /** At once while nothing waits, so the caller sees the browser's own errors. */
    run: (run: () => void) => (first ? void add(run, false) : run()),
    wait: (host: Promise<string | null>, then: (host: string | null) => (() => void) | null) => {
      const job = add(null, true);
      const settle = (value: unknown) => {
        if (!job.waiting) return;
        job.waiting = false;
        job.run = then(typeof value === "string" ? value : null);
        drain();
      };
      setTimer(() => settle(null), CROSS_SITE_TIMEOUT_MS);
      apply(promiseThen, host, [settle, () => settle(null)]);
    },
  };
}

/**
 * Labels and the site poster of a document on a site host, from natives taken before the runtime's hooks. While the
 * window shows a document it inherits, it asks through that page's lookup: the worker may not see a blank window.
 */
export function createSiteMessaging(
  win: Realm,
  ctx: UrlContext,
  invoke: Invoke,
  sites: SiteContext | undefined,
  inherited: () => LabelLookup | undefined = () => undefined,
): { labels: SiteLabels; post: CrossSitePost; lookup: LabelLookup } | null {
  if (!sites) return null;
  // Window operations called without a receiver run on their own window, so they need no binding.
  const own = createLabelLookup(win.fetch, ctx.origin);
  const lookup: LabelLookup = (realOrigin) => (inherited() ?? own)(realOrigin);
  const labels = createSiteLabels(sites, () => originOf(ctx.realUrl()), lookup);
  const post = createCrossSitePoster(labels, invoke, win.postMessage, win.setTimeout);
  return { labels, post, lookup };
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
  const queue = createOrderedQueue(setTimer);
  return (target, message, targetOrigin, rest) => {
    const options = typeof targetOrigin === "object" && targetOrigin !== null ? targetOrigin : null;
    const wanted = options ? (options as { targetOrigin?: unknown }).targetOrigin : targetOrigin;
    // A missing target means "/", the sender's own origin, which another host never is.
    const text = wanted === undefined ? "/" : toText(wanted);
    if (text === "/") return;
    const transfer = options ? (options as { transfer?: unknown }).transfer : rest.length ? rest[0] : undefined;
    // An options member left undefined takes its default, as if it were missing.
    const send = (host: string, envelope: MessageEnvelope) => () =>
      invoke(
        nativePost,
        target,
        options
          ? [envelope, { __proto__: null, targetOrigin: host, transfer }]
          : rest.length
            ? [envelope, host, transfer]
            : [envelope, host],
      );
    let real = text;
    if (text !== "*") {
      const url = parseUrl(text);
      // The browser refuses a target that is no URL, and the caller sees its error.
      if (!url) return send(text, labels.envelope(message, text))();
      if (!isWebUrl(url)) return;
      real = originOf(url);
    }
    const envelope = labels.envelope(message, real);
    const known = real === "*" ? real : labels.hostOf(real);
    if (known !== null) return queue.run(send(known, envelope));
    queue.wait(labels.resolve(real), (host) => (host === null ? null : send(host, envelope)));
  };
}

/**
 * Hooks `MessageEvent.prototype.data` and returns what the origin getter reports for a message from another site
 * host: the envelope's real origin once it checks out, else "null" so origin checks fail closed. The listener stops a
 * forged or misaddressed envelope before any page listener, and holds a claim only the worker can confirm, dispatching
 * it again in arrival order. An envelope from this host or a sandboxed frame just loses its wrapping.
 */
export function installSiteMessages(
  win: Realm,
  ctx: UrlContext,
  labels: SiteLabels,
  sourceOf: (event: object) => unknown,
): DocumentListeners & { origin(event: object, nativeOrigin: string): string | undefined } {
  const NativeMessageEvent = win.MessageEvent;
  const proto = NativeMessageEvent.prototype;
  const nativeOrigin = ownDescriptor(proto, "origin")?.get;
  const dataDescriptor = ownDescriptor(proto, "data");
  const nativeData = dataDescriptor?.get;
  const nativePorts = ownDescriptor(proto, "ports")?.get;
  const stop = win.Event.prototype.stopImmediatePropagation;
  const dispatch = win.EventTarget.prototype.dispatchEvent;
  const addListener = win.addEventListener;
  const checked = new NativeWeakMap<object, Verified | null>();
  const queue = createOrderedQueue(win.setTimeout);

  /** Undefined for an event that is neither a trusted message from another site host nor a trusted envelope. */
  const check = (event: object, origin: string): Verified | null | undefined => {
    // A held message comes back untrusted, already checked.
    if (apply(weakHas, checked, [event])) return apply(weakGet, checked, [event]) as Verified | null;
    // isTrusted is an own, unforgeable property; an event the page made itself stays as it made it.
    if ((event as Event).isTrusted !== true || !nativeData) return undefined;
    const data: unknown = apply(nativeData, event, []);
    let verified: Verified | null | undefined = labels.verify(origin, data);
    if (verified === undefined) {
      // The sender could not read this window, which sits on its host or in a sandbox; the native origin stands.
      const envelope = readMessageEnvelope(data);
      if (!envelope) return undefined;
      verified = { __proto__: null, target: envelope.t, data: envelope.d, sure: true } as Verified;
    }
    apply(weakSet, checked, [event, verified]);
    return verified;
  };

  /**
   * A plain message from another site host passes with origin "null"; an envelope must check out and be ours. Only
   * called once `check` has read the event, so the data getter is there.
   */
  const deliverable = (event: object, verified: Verified | null): boolean =>
    verified
      ? verified.target === "*" || verified.target === originOf(ctx.realUrl())
      : readMessageEnvelope(apply(nativeData as () => unknown, event, [])) === null;

  /** Chromium keeps a stopped event stopped, so page listeners get a copy that carries the same verdict. */
  const redeliver = (event: object, origin: string) => () => {
    const verified = apply(weakGet, checked, [event]) as Verified | null;
    if (!deliverable(event, verified)) return;
    let again = event;
    try {
      again = new NativeMessageEvent("message", {
        __proto__: null,
        data: apply(nativeData as () => unknown, event, []),
        origin,
        source: sourceOf(event),
        ports: apply(nativePorts as () => unknown, event, []),
      } as MessageEventInit);
      apply(weakSet, checked, [again, verified]);
    } catch {
      // Firefox takes no cross-origin window as a source, and dispatches the stopped event again.
    }
    apply(dispatch, win, [again]);
  };

  if (dataDescriptor && nativeData && nativeOrigin) {
    define(proto, "data", {
      ...dataDescriptor,
      get: maskNative(function (this: MessageEvent) {
        const data: unknown = apply(nativeData, this, []);
        const verified = check(this, toText(apply(nativeOrigin, this, [])));
        return verified && verified.sure ? verified.data : data;
      }, nativeData),
    });
  }

  const drop = (event: Event) => {
    try {
      if (event.isTrusted !== true) return;
      const origin = toText(apply(nativeOrigin as () => unknown, event, []));
      const verified = check(event, origin);
      if (verified === undefined) return;
      if (verified && !verified.sure) {
        apply(stop, event, []);
        queue.wait(labels.resolve(verified.origin as string), (host) => {
          if (host === verified.host) verified.sure = true;
          else apply(weakSet, checked, [event, null]);
          return redeliver(event, origin);
        });
      } else if (queue.busy()) {
        // Behind a held message, so page listeners see messages in the order they came.
        apply(stop, event, []);
        queue.run(redeliver(event, origin));
      } else if (!deliverable(event, verified)) apply(stop, event, []);
    } catch {
      // Only a message event has these getters; anything else passes as it came.
    }
  };

  return {
    origin: (event, origin) => {
      const verified = check(event, origin);
      if (verified === undefined) return undefined;
      return verified && verified.sure ? verified.origin : "null";
    },
    // Capture on the window, added before any page listener, so it runs first.
    listen: () => apply(addListener, win, ["message", drop, true]),
  } as DocumentListeners & { origin(event: object, nativeOrigin: string): string | undefined };
}
