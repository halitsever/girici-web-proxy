import { decodeUrl } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Every proxied page runs on our origin, so postMessage targets and the origin reported to receivers are translated. */
export function installMessaging(win: Realm, ctx: UrlContext): void {
  const nativePost = win.postMessage.bind(win) as (...args: unknown[]) => void;
  win.postMessage = function (message: unknown, targetOrigin?: unknown, ...rest: unknown[]) {
    if (typeof targetOrigin === "string") {
      nativePost(message, rewriteTarget(targetOrigin, ctx.origin), ...rest);
    } else if (targetOrigin && typeof targetOrigin === "object" && "targetOrigin" in targetOrigin) {
      const options = targetOrigin as { targetOrigin?: unknown };
      const fixed =
        typeof options.targetOrigin === "string"
          ? rewriteTarget(options.targetOrigin, ctx.origin)
          : options.targetOrigin;
      nativePost(message, { ...options, targetOrigin: fixed }, ...rest);
    } else {
      nativePost(message, targetOrigin, ...rest);
    }
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

/** A real http(s) origin is replaced with our origin so the browser still delivers; wildcards pass through. */
function rewriteTarget(targetOrigin: string, origin: string): string {
  if (targetOrigin === "*" || targetOrigin === "/") return targetOrigin;
  try {
    const url = new URL(targetOrigin);
    if (url.protocol === "http:" || url.protocol === "https:") return origin;
  } catch {
    // A value that is not a URL is left for the browser to reject as it would.
  }
  return targetOrigin;
}
