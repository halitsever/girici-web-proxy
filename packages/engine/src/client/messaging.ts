import { decodeUrl } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Every proxied page runs on our origin, so postMessage targets and the origin reported to receivers are translated. */
export function installMessaging(win: Realm, ctx: UrlContext): void {
  const nativePost = win.postMessage.bind(win) as (...args: unknown[]) => void;
  win.postMessage = function (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) {
    if (targetOrigin && typeof targetOrigin === "object" && "targetOrigin" in targetOrigin) {
      const options = targetOrigin as { targetOrigin?: unknown };
      const decision = resolveTarget(options.targetOrigin, ctx);
      if (decision.deliver) nativePost(message, { ...options, targetOrigin: decision.target }, ...rest);
      return;
    }
    const decision = resolveTarget(targetOrigin, ctx);
    if (decision.deliver) nativePost(message, decision.target, ...rest);
  } as typeof win.postMessage;

  const descriptor = Object.getOwnPropertyDescriptor(win.MessageEvent.prototype, "origin");
  const nativeOrigin = descriptor?.get;
  if (!nativeOrigin) return;
  Object.defineProperty(win.MessageEvent.prototype, "origin", {
    ...descriptor,
    get(this: MessageEvent) {
      // The sender is on our origin too, so its real origin is read from its own address when reachable.
      try {
        const source = this.source as Window | null;
        if (source) {
          const href = source.location.href;
          const real =
            new URL(href).origin === ctx.origin ? decodeUrl(new URL(href).pathname + new URL(href).search) : null;
          if (real) return real.origin;
        }
      } catch {
        // A cross-origin or detached sender keeps the browser's own value.
      }
      return String(nativeOrigin.call(this));
    },
  });
}

/**
 * The receiver (this window) runs on our origin, so a message addressed to a real origin is delivered as our origin
 * only when that origin is this page's real one; otherwise it is dropped, as the native origin check would.
 */
function resolveTarget(targetOrigin: unknown, ctx: UrlContext): { deliver: boolean; target?: unknown } {
  if (typeof targetOrigin !== "string" || targetOrigin === "*" || targetOrigin === "/") {
    return { deliver: true, target: targetOrigin };
  }
  let url: URL;
  try {
    url = new URL(targetOrigin);
  } catch {
    return { deliver: true, target: targetOrigin };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { deliver: true, target: targetOrigin };
  return url.origin === ctx.realUrl().origin ? { deliver: true, target: ctx.origin } : { deliver: false };
}
