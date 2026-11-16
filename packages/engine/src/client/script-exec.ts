import type { ConstructorKind, FunctionBodyKind, FunctionSource } from "../rewrite/js.ts";
import { apply, define, joined, stringOf } from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

// Taken at load: the hooks run on page calls, after page code may have replaced these.
const construct = Reflect.construct;
const protoOf = Reflect.getPrototypeOf;
/** The kinds of the samples below, in their order. */
const SAMPLE_KINDS: readonly FunctionBodyKind[] = ["generator", "async", "asyncGenerator"];

/** Code reaching the engine through Function, string timers or eval is rewritten so its location use stays proxied. */
export function installScriptExec(
  win: Realm,
  rewriteScript: (code: string) => string,
  rewriteFunction: (params: string, body: string, kind: ConstructorKind) => FunctionSource,
): void {
  const wrapConstructor = (native: AnyFunction, kind: ConstructorKind): AnyFunction => {
    const hooked = function (this: unknown, ...args: unknown[]): unknown {
      if (args.length === 0) return construct(native as never, args, (new.target ?? hooked) as never);
      // Each argument becomes text once, in order, as the constructor would make it; the last one is the body.
      let params = "";
      for (let index = 0; index < args.length - 1; index++) params += (index ? "," : "") + stringOf(args[index]);
      const source = rewriteFunction(params, stringOf(args[args.length - 1]), kind);
      const texts = args.length > 1 ? [source.params, source.body] : [source.body];
      return construct(native as never, texts, (new.target ?? hooked) as never);
    } as AnyFunction;
    // Sharing the native prototype keeps `instanceof` and `.prototype` intact.
    (hooked as { prototype: unknown }).prototype = (native as { prototype: unknown }).prototype;
    maskNative(hooked, native);
    return hooked;
  };

  const FunctionCtor = win.Function as unknown as AnyFunction;
  const samples = realmSamples(FunctionCtor);
  const hookedFunction = wrapConstructor(FunctionCtor, "function");
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
      value: wrapConstructor(proto.constructor, SAMPLE_KINDS[index] as FunctionBodyKind),
    });
  }

  const timers = ["setTimeout", "setInterval"] as const;
  for (let index = 0; index < timers.length; index++) {
    const name = timers[index] as (typeof timers)[number];
    const native = win[name] as unknown as AnyFunction;
    // Through apply: a replaced Function.prototype.call would be handed the native timer, which runs code unrewritten.
    // A handler that is not a function is code, as the native would read it: text made once, then rewritten.
    const hooked = function (this: unknown, handler: unknown, ...rest: unknown[]): unknown {
      const code = typeof handler === "function" ? handler : rewriteScript(stringOf(handler));
      return apply(native, win, joined([code], rest));
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
