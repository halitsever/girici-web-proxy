/** Every function type is assignable to this, as with `Function`, which the lint rules reject. */
type AnyFunction = (...args: never[]) => unknown;

export type Invoke = (fn: AnyFunction, self: unknown, args: readonly unknown[]) => unknown;

/**
 * postMessage and Location calls take their sender from the calling realm. A function compiled by the window's own
 * realm makes that realm the caller, even when another window's runtime installed the hooks.
 */
export function createInvoker(win: { Function: FunctionConstructor }): Invoke {
  try {
    const compile = new win.Function("apply", "return function (f, t, a) { return apply(f, t, a); }") as (
      apply: typeof Reflect.apply,
    ) => Invoke;
    return compile(Reflect.apply);
  } catch {
    // A realm that refuses to compile code keeps the direct call; only the reported sender can then be wrong.
    return (fn, self, args) => Reflect.apply(fn, self, args);
  }
}
