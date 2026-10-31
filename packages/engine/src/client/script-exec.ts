import { apply, define, joined } from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

/** Code reaching the engine through Function, string timers or eval is rewritten so its location use stays proxied. */
export function installScriptExec(
  win: Realm,
  rewriteScript: (code: string) => string,
  rewriteBody: (code: string) => string,
): void {
  const wrapConstructor = (native: AnyFunction): AnyFunction => {
    const hooked = function (this: unknown, ...args: unknown[]): unknown {
      const body = args[args.length - 1];
      // The last argument is the function body; earlier ones are parameter names.
      if (args.length > 0 && typeof body === "string") args[args.length - 1] = rewriteBody(body);
      return Reflect.construct(native as never, args, (new.target ?? hooked) as never);
    } as AnyFunction;
    // Sharing the native prototype keeps `instanceof` and `.prototype` intact.
    (hooked as { prototype: unknown }).prototype = (native as { prototype: unknown }).prototype;
    maskNative(hooked, native);
    return hooked;
  };

  const FunctionCtor = win.Function as unknown as AnyFunction;
  const hookedFunction = wrapConstructor(FunctionCtor);
  win.Function = hookedFunction as unknown as FunctionConstructor;
  // `(function(){}).constructor` reaches the native ctor through the shared prototype, so route it too.
  define(win.Function.prototype, "constructor", {
    configurable: true,
    writable: true,
    value: hookedFunction,
  });

  // Generator and async constructors are reached through a sample function's `constructor`, not a global.
  // Indexed, without spreads: adopting a frame installs this inside a page call.
  const samples = [function* () {}, async function () {}, async function* () {}];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const proto = Object.getPrototypeOf(sample) as { constructor: AnyFunction };
    define(proto, "constructor", {
      configurable: true,
      writable: true,
      value: wrapConstructor(proto.constructor),
    });
  }

  const timers = ["setTimeout", "setInterval"] as const;
  for (let index = 0; index < timers.length; index++) {
    const name = timers[index] as (typeof timers)[number];
    const native = win[name] as unknown as AnyFunction;
    // Through apply: a replaced Function.prototype.call would be handed the native timer, which runs code unrewritten.
    const hooked = function (this: unknown, handler: unknown, ...rest: unknown[]): unknown {
      return apply(native, win, joined([typeof handler === "string" ? rewriteScript(handler) : handler], rest));
    } as AnyFunction;
    maskNative(hooked, native);
    (win as unknown as Record<string, unknown>)[name] = hooked;
  }
}
