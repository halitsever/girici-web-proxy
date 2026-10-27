import { PROXY_PREFIX } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Diagnostics leak our origin, so StorageEvent URLs, stack traces and Performance entries show the real addresses. */
export function installMasking(win: Realm, ctx: UrlContext): void {
  wrapGetter(win.StorageEvent?.prototype, "url", (value) => (value ? ctx.fromProxy(value) : value));

  const errorStack = Object.getOwnPropertyDescriptor(win.Error.prototype, "stack");
  if (errorStack?.get || typeof (win.Error.prototype as { stack?: unknown }).stack === "string") {
    wrapGetter(win.Error.prototype, "stack", (value) => realAddresses(value, ctx));
  }

  wrapGetter(win.PerformanceEntry?.prototype, "name", (value) => realAddresses(value, ctx));
}

function realAddresses(text: string, ctx: UrlContext): string {
  if (!text.includes(PROXY_PREFIX)) return text;
  // Replaces each proxied address embedded in free text with the real one, leaving the rest untouched.
  return text.replace(new RegExp(`${escapeRegExp(ctx.origin)}${PROXY_PREFIX}[^\\s'")]*`, "g"), (match) =>
    ctx.fromProxy(match),
  );
}

function wrapGetter(proto: object | undefined, name: string, map: (value: string) => string): void {
  if (!proto) return;
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  const get = descriptor?.get;
  if (!get) return;
  Object.defineProperty(proto, name, {
    ...descriptor,
    get(this: unknown) {
      const value = get.call(this);
      return typeof value === "string" ? map(value) : value;
    },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
