import type { Realm } from "./url-context.ts";

type AnyFunction = (...args: unknown[]) => unknown;

/** Code reaching the engine through Function, string timers or eval is rewritten so its location use stays proxied. */
export function installScriptExec(
  win: Realm,
  rewriteScript: (code: string) => string,
  rewriteBody: (code: string) => string,
): void {
  // Hooked functions map to their natives, so a masked toString() can report the native source.
  const natives = new WeakMap<object, AnyFunction>();

  const wrapConstructor = (native: AnyFunction): AnyFunction => {
    const hooked = function (this: unknown, ...args: unknown[]): unknown {
      const body = args[args.length - 1];
      // The last argument is the function body; earlier ones are parameter names.
      if (args.length > 0 && typeof body === "string") args[args.length - 1] = rewriteBody(body);
      return Reflect.construct(native as never, args, (new.target ?? hooked) as never);
    } as AnyFunction;
    // Sharing the native prototype keeps `instanceof` and `.prototype` intact.
    (hooked as { prototype: unknown }).prototype = (native as { prototype: unknown }).prototype;
    natives.set(hooked, native);
    return hooked;
  };

  const FunctionCtor = win.Function as unknown as AnyFunction;
  win.Function = wrapConstructor(FunctionCtor) as unknown as FunctionConstructor;

  // Generator and async constructors are reached through a sample function's `constructor`, not a global.
  for (const sample of [function* () {}, async function () {}, async function* () {}]) {
    const proto = Object.getPrototypeOf(sample) as { constructor: AnyFunction };
    Object.defineProperty(proto, "constructor", {
      configurable: true,
      writable: true,
      value: wrapConstructor(proto.constructor),
    });
  }

  for (const name of ["setTimeout", "setInterval"] as const) {
    const native = win[name] as unknown as AnyFunction;
    const hooked = function (this: unknown, handler: unknown, ...rest: unknown[]): unknown {
      return native.call(win, typeof handler === "string" ? rewriteScript(handler) : handler, ...rest);
    } as AnyFunction;
    natives.set(hooked, native);
    win[name] = hooked as unknown as Window[typeof name];
  }

  const nativeToString = win.Function.prototype.toString;
  const maskedToString = function (this: object): string {
    return nativeToString.call(natives.get(this) ?? this);
  };
  natives.set(maskedToString, nativeToString as AnyFunction);
  win.Function.prototype.toString = maskedToString;
}
