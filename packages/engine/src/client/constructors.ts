import { maskNative } from "./native-mask.ts";

// Taken at load: a replacement installed later would receive the native as the trap's target.
const construct = Reflect.construct;

/** Maps a constructor's arguments. Its prototype points back at the hook, so an instance never leads to the native. */
export function hookConstructor<T extends abstract new (...args: never[]) => object>(
  native: T,
  args: (input: unknown[]) => unknown[],
): T {
  const hooked = new Proxy(native, {
    construct: (target, input: unknown[], newTarget: NewableFunction) =>
      construct(target, args(input), newTarget) as object,
  });
  Object.defineProperty(native.prototype, "constructor", { value: hooked, writable: true, configurable: true });
  return maskNative(hooked, native);
}
