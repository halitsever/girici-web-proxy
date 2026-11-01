import { apply, define, isWebUrl, originOf, parseUrl, toText } from "../shared/primordials.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { SiteLabels } from "./site-labels.ts";
import { installSiteMessages, type CrossSitePost } from "./site-messages.ts";
import { realOriginOf, type Realm, type UrlContext } from "./url-context.ts";
import type { WindowGuard } from "./windows.ts";

export { createCrossSitePoster, CROSS_SITE_TIMEOUT_MS, type CrossSitePost } from "./site-messages.ts";

export type Send = (...args: unknown[]) => void;

// Taken at load: the event getters run on page calls, after page code may have replaced these.
const ownDescriptor = Object.getOwnPropertyDescriptor;

/**
 * Every proxied page runs on our origin, so postMessage targets and the origin reported to receivers are translated.
 * With `labels` (subdomain mode) it returns the listener that screens messages from other site hosts.
 */
export function installMessaging(
  win: Realm,
  ctx: UrlContext,
  invoke: Invoke,
  guard: WindowGuard,
  labels?: SiteLabels,
): DocumentListeners | null {
  const native = win.postMessage;
  const send: Send = (...args) => invoke(native, win, args);
  win.postMessage = function (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) {
    const own = originOf(ctx.realUrl());
    post(send, own, ctx.origin, message, targetOrigin, rest, own);
  } as typeof win.postMessage;

  const proto = win.MessageEvent.prototype;
  const sourceDescriptor = ownDescriptor(proto, "source");
  const nativeSource = sourceDescriptor?.get;
  const sourceOf = (event: unknown): unknown =>
    nativeSource ? apply(nativeSource, event, []) : (event as { source: unknown }).source;
  if (sourceDescriptor && nativeSource) {
    define(proto, "source", {
      ...sourceDescriptor,
      get: maskNative(function (this: MessageEvent) {
        return guard.wrap(apply(nativeSource, this, []));
      }, nativeSource),
    });
  }

  // Before the origin hook below, so it takes the native getter.
  const site = labels ? installSiteMessages(win, ctx, labels) : null;
  const descriptor = ownDescriptor(proto, "origin");
  const nativeOrigin = descriptor?.get;
  if (!nativeOrigin) return site;
  define(proto, "origin", {
    ...descriptor,
    get: maskNative(function (this: MessageEvent) {
      const origin = toText(apply(nativeOrigin, this, []));
      const claimed = site?.origin(this, origin);
      if (claimed !== undefined) return claimed;
      if (origin !== ctx.origin) return origin;
      // The sender is on our origin too. Its address, or else its own runtime, tells its real origin.
      return realOriginOf(sourceOf(this), ctx.origin) ?? origin;
    }, nativeOrigin),
  });
  return site;
}

/**
 * Rewritten `x.postMessage()` calls land here. The browser takes event.source from the realm that calls the native
 * postMessage, so a window gets a stand-in that sends from this realm.
 */
export function createMessageSender(
  win: Realm,
  ctx: UrlContext,
  invoke: Invoke,
  isWrapper: (value: unknown) => boolean = () => false,
  crossSite?: CrossSitePost,
): (value: unknown) => unknown {
  // Captured before installMessaging replaces it; window methods live on the window itself, not on Window.prototype.
  const native = win.postMessage;
  return (value) => {
    try {
      // A restricted window's own postMessage already translates.
      if (!isWindow(value) || isWrapper(value)) return value;
      void value.location.href;
    } catch {
      // A cross-origin window hides its address. Its own postMessage needs no translation, unless it is on another host.
      if (!crossSite) return value;
      return {
        postMessage: (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) =>
          crossSite(value as object, message, targetOrigin, rest),
      };
    }
    // Its page can redefine `origin`, so the address or its runtime says where it really is.
    const realOrigin = realOriginOf(value, ctx.origin) ?? "null";
    const send: Send = (...args) => invoke(native, value, args);
    return {
      postMessage: (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) =>
        post(send, realOrigin, ctx.origin, message, targetOrigin, rest, originOf(ctx.realUrl())),
    };
  };
}

/** Delivers as our origin a message addressed to the receiver's real origin, and drops one addressed elsewhere. */
export function post(
  send: Send,
  realOrigin: string,
  proxyOrigin: string,
  message: unknown,
  targetOrigin: unknown,
  rest: unknown[],
  senderOrigin?: string,
): void {
  // Only a transfer list follows the target, so it is passed by index rather than spread.
  const deliver = (target: unknown) => (rest.length ? send(message, target, rest[0]) : send(message, target));
  if (targetOrigin && typeof targetOrigin === "object" && "targetOrigin" in targetOrigin) {
    const options = targetOrigin as { targetOrigin?: unknown };
    const decision = resolveTarget(options.targetOrigin, realOrigin, proxyOrigin, senderOrigin);
    if (decision.deliver) deliver({ ...options, targetOrigin: decision.target });
    return;
  }
  const decision = resolveTarget(targetOrigin, realOrigin, proxyOrigin, senderOrigin);
  if (decision.deliver) deliver(decision.target);
}

/**
 * The receiver runs on our origin, so a message addressed to a real origin is delivered as our origin only when that
 * origin is the receiver's real one; otherwise it is dropped, as the native origin check would.
 */
function resolveTarget(
  targetOrigin: unknown,
  realOrigin: string,
  proxyOrigin: string,
  senderOrigin?: string,
): { deliver: boolean; target?: unknown } {
  // "/" means the sender's own origin, which on our shared origin only the real origins can tell.
  if (targetOrigin === "/" && senderOrigin !== undefined) {
    return senderOrigin === realOrigin ? { deliver: true, target: proxyOrigin } : { deliver: false };
  }
  if (typeof targetOrigin !== "string" || targetOrigin === "*" || targetOrigin === "/") {
    return { deliver: true, target: targetOrigin };
  }
  const url = parseUrl(targetOrigin);
  if (!url || !isWebUrl(url)) return { deliver: true, target: targetOrigin };
  return originOf(url) === realOrigin ? { deliver: true, target: proxyOrigin } : { deliver: false };
}

function isWindow(value: unknown): value is Window {
  return typeof value === "object" && value !== null && (value as { window?: unknown }).window === value;
}
