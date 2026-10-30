import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

// Taken at load: a replacement installed later would receive a native or a hook to look one up with.
const apply = Reflect.apply;
const lookup = WeakMap.prototype.get;
const store = WeakMap.prototype.set;

// Hooked functions map to the native they stand in for, so a masked toString can report the native source.
const natives = new WeakMap<object, AnyFunction>();

/** Records that `hooked` replaces `native`; anti-tamper checks that read fn.toString() then see "[native code]". */
export function maskNative<T>(hooked: T, native: unknown): T {
  if (typeof hooked === "function" && typeof native === "function") {
    apply(store, natives, [hooked, native]);
  }
  return hooked;
}

/** Routes Function.prototype.toString through the registry, so every masked hook reports its native's source. */
export function installToStringMask(win: Realm): void {
  const nativeToString = win.Function.prototype.toString;
  const masked = function (this: object): string {
    return apply(nativeToString, (apply(lookup, natives, [this]) as AnyFunction | undefined) ?? this, []) as string;
  };
  apply(store, natives, [masked, nativeToString]);
  win.Function.prototype.toString = masked;
}
