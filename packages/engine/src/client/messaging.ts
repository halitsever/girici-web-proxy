import { apply, define, isWebUrl, originOf, parseUrl, toText } from "../shared/primordials.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import { realOriginOf, type Realm, type UrlContext } from "./url-context.ts";
import type { WindowGuard } from "./windows.ts";

export type Send = (...args: unknown[]) => void;

// Taken at load: the event getters run on page calls, after page code may have replaced these.
const ownDescriptor = Object.getOwnPropertyDescriptor;

/** Every proxied page runs on our origin, so postMessage targets and the origin reported to receivers are translated. */
export function installMessaging(win: Realm, ctx: UrlContext, invoke: Invoke, guard: WindowGuard): void {
  const native = win.postMessage;
  const send: Send = (...args) => invoke(native, win, args);
  win.postMessage = function (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) {
    post(send, originOf(ctx.realUrl()), ctx.origin, message, targetOrigin, rest);
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

  const descriptor = ownDescriptor(proto, "origin");
  const nativeOrigin = descriptor?.get;
  if (!nativeOrigin) return;
  define(proto, "origin", {
    ...descriptor,
    get: maskNative(function (this: MessageEvent) {
      const origin = toText(apply(nativeOrigin, this, []));
      if (origin !== ctx.origin) return origin;
      // The sender is on our origin too. Its address, or else its own runtime, tells its real origin.
      return realOriginOf(sourceOf(this), ctx.origin) ?? origin;
    }, nativeOrigin),
  });
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
): (value: unknown) => unknown {
  // Captured before installMessaging replaces it; window methods live on the window itself, not on Window.prototype.
  const native = win.postMessage;
  return (value) => {
    try {
      // A restricted window's own postMessage already translates.
      if (!isWindow(value) || isWrapper(value)) return value;
      void value.location.href;
    } catch {
      // A cross-origin window hides its address, and its own postMessage needs no translation.
      return value;
    }
    // Its page can redefine `origin`, so the address or its runtime says where it really is.
    const realOrigin = realOriginOf(value, ctx.origin) ?? "null";
    const send: Send = (...args) => invoke(native, value, args);
    return {
      postMessage: (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) =>
        post(send, realOrigin, ctx.origin, message, targetOrigin, rest),
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
): void {
  if (targetOrigin && typeof targetOrigin === "object" && "targetOrigin" in targetOrigin) {
    const options = targetOrigin as { targetOrigin?: unknown };
    const decision = resolveTarget(options.targetOrigin, realOrigin, proxyOrigin);
    if (decision.deliver) send(message, { ...options, targetOrigin: decision.target }, ...rest);
    return;
  }
  const decision = resolveTarget(targetOrigin, realOrigin, proxyOrigin);
  if (decision.deliver) send(message, decision.target, ...rest);
}

/**
 * The receiver runs on our origin, so a message addressed to a real origin is delivered as our origin only when that
 * origin is the receiver's real one; otherwise it is dropped, as the native origin check would.
 */
function resolveTarget(
  targetOrigin: unknown,
  realOrigin: string,
  proxyOrigin: string,
): { deliver: boolean; target?: unknown } {
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
