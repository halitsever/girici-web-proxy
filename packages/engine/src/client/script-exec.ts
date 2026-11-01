import { apply, define, joined } from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

// Taken at load: the hooks run on page calls, after page code may have replaced these.
const construct = Reflect.construct;
const protoOf = Reflect.getPrototypeOf;

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
      return construct(native as never, args, (new.target ?? hooked) as never);
    } as AnyFunction;
    // Sharing the native prototype keeps `instanceof` and `.prototype` intact.
    (hooked as { prototype: unknown }).prototype = (native as { prototype: unknown }).prototype;
    maskNative(hooked, native);
    return hooked;
  };

  const FunctionCtor = win.Function as unknown as AnyFunction;
  const samples = realmSamples(FunctionCtor);
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
  for (let index = 0; index < samples.length; index++) {
    const proto = protoOf(samples[index] as object) as { constructor: AnyFunction };
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

/** Samples made by the window's own Function, since an adopted window's constructors are not this realm's. */
function realmSamples(FunctionCtor: AnyFunction): readonly unknown[] {
  try {
    const make = construct(FunctionCtor as never, [
      "return [function* () {}, async function () {}, async function* () {}]",
    ]) as () => unknown[];
    return make();
  } catch {
    // A realm that may not compile code cannot reach these constructors with code either, unless it is this one.
    return FunctionCtor === Function ? [function* () {}, async function () {}, async function* () {}] : [];
  }
}
