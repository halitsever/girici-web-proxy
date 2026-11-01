import { createContext, runInContext, runInThisContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installScriptExec } from "../src/client/script-exec.ts";
import type { Realm } from "../src/client/url-context.ts";

/** A separate realm, like the blank window of a frame or popup another window's runtime adopts. */
function childRealm(): { realm: Realm; run: (code: string) => unknown } {
  const context = createContext({ setTimeout: () => 0, setInterval: () => 0 });
  const realm = runInContext("this", context) as Realm;
  return { realm, run: (code) => runInContext(code, context) };
}

const SAMPLES = ["(function* () {})", "(async function () {})", "(async function* () {})"];

describe("installScriptExec", () => {
  it("hooks the generator and async constructors of the realm it is installed into", () => {
    const { realm, run } = childRealm();
    const bodies: string[] = [];
    installScriptExec(
      realm,
      (code) => code,
      (params, body) => {
        bodies.push(body);
        return { params, body };
      },
    );
    SAMPLES.forEach((sample, index) => run(`${sample}.constructor("return ${index}")`));
    expect(bodies).toEqual(["return 0", "return 1", "return 2"]);
  });

  it("tells the rewriter which kind of body each constructor compiles", () => {
    const { realm, run } = childRealm();
    const kinds: unknown[] = [];
    installScriptExec(
      realm,
      (code) => code,
      (params, body, kind) => {
        kinds.push(kind);
        return { params, body };
      },
    );
    run(`Function("return 1")`);
    SAMPLES.forEach((sample) => run(`${sample}.constructor("return 1")`));
    expect(kinds).toEqual(["function", "generator", "async", "asyncGenerator"]);
  });

  it("hands the rewriter the parameters and body as the constructor reads them, objects and all", () => {
    const { realm, run } = childRealm();
    const seen: unknown[] = [];
    installScriptExec(
      realm,
      (code) => code,
      (params, body) => {
        seen.push([params, body]);
        return { params: params.replace("location", "where"), body: body.replace("location", "where") };
      },
    );
    const made = run(`
      let reads = 0;
      const body = { toString() { reads++; return "return [a, b, location]" } };
      const fn = Function("a = location", { toString() { reads++; return "b" } }, body);
      [fn.toString(), reads]
    `) as [string, number];
    expect(seen).toEqual([["a = location,b", "return [a, b, location]"]]);
    expect(made[0]).toBe("function anonymous(a = where,b\n) {\nreturn [a, b, where]\n}");
    // Each argument is read once.
    expect(made[1]).toBe(2);
    expect(() => run(`Function(Symbol("x"))`)).toThrow(TypeError);
  });

  it("rewrites a timer handler that is neither a function nor a string, read as the native reads it", () => {
    const { realm, run } = childRealm();
    const scripts: string[] = [];
    installScriptExec(
      realm,
      (code) => {
        scripts.push(code);
        return code;
      },
      (params, body) => ({ params, body }),
    );
    run(`setTimeout({ toString() { return "location.href" } }); setInterval(null)`);
    expect(scripts).toEqual(["location.href", "null"]);
  });

  it("leaves the constructors of the realm that adopts the window alone", () => {
    const constructors = () =>
      SAMPLES.map(
        (sample) => (Object.getPrototypeOf(runInThisContext(sample)) as { constructor: unknown }).constructor,
      );
    const own = constructors();
    installScriptExec(
      childRealm().realm,
      (code) => code,
      (params, body) => ({ params, body }),
    );
    expect(constructors()).toEqual(own);
  });

  it("never hands a constructor's native to a replaced Reflect.construct", () => {
    const { realm, run } = childRealm();
    installScriptExec(
      realm,
      (code) => code,
      (params, body) => ({ params, body }),
    );
    const construct = Reflect.construct;
    const leaked: unknown[] = [];
    Reflect.construct = ((target: never, args: never, newTarget?: never) => {
      leaked.push(target);
      return construct(target, args, newTarget);
    }) as typeof Reflect.construct;
    try {
      run(`Function("return 1")`);
      run(`(function* () {}).constructor("yield 1")`);
    } finally {
      Reflect.construct = construct;
    }
    expect(leaked).toEqual([]);
  });
});
