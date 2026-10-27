import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

// Hooked functions map to the native they stand in for, so a masked toString can report the native source.
const natives = new WeakMap<object, AnyFunction>();

/** Records that `hooked` replaces `native`; anti-tamper checks that read fn.toString() then see "[native code]". */
export function maskNative<T>(hooked: T, native: unknown): T {
  if (typeof hooked === "function" && typeof native === "function") {
    natives.set(hooked as object, native as AnyFunction);
  }
  return hooked;
}

/** Routes Function.prototype.toString through the registry, so every masked hook reports its native's source. */
export function installToStringMask(win: Realm): void {
  const nativeToString = win.Function.prototype.toString;
  const masked = function (this: object): string {
    return nativeToString.call(natives.get(this) ?? this);
  };
  natives.set(masked, nativeToString as AnyFunction);
  win.Function.prototype.toString = masked;
}
