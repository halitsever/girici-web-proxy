/** Every function type is assignable to this, as with `Function`, which the lint rules reject. */
type AnyFunction = (...args: never[]) => unknown;

export type Invoke = (fn: AnyFunction, self: unknown, args: readonly unknown[]) => unknown;

// Taken at load, so a page that replaced Reflect.apply never receives the natives passed through here.
const apply = Reflect.apply;

/**
 * postMessage and Location calls take their sender from the calling realm. A function compiled by the window's own
 * realm makes that realm the caller, even when another window's runtime installed the hooks.
 */
export function createInvoker(win: { Function: FunctionConstructor }): Invoke {
  try {
    const compile = new win.Function("apply", "return function (f, t, a) { return apply(f, t, a); }") as (
      apply: typeof Reflect.apply,
    ) => Invoke;
    return compile(apply);
  } catch {
    // A realm that refuses to compile code keeps the direct call; only the reported sender can then be wrong.
    return (fn, self, args) => apply(fn, self, args);
  }
}

/** False when the realm's document is gone, since browsers then drop or refuse the navigation. */
export type AssignHref = (location: object, url: string) => boolean;

/** WebKit takes the referrer from the realm that assigns `href`, and from the callee's realm for a call to the setter. */
export function createHrefAssigner(win: { Function: FunctionConstructor }): AssignHref {
  try {
    return new win.Function(
      "return function (l, u) { if (document !== window.document) return false; l.href = u; return true; }",
    )() as AssignHref;
  } catch {
    return (location, url) => {
      (location as { href: string }).href = url;
      return true;
    };
  }
}
