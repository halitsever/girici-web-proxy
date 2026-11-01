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
      (code) => {
        bodies.push(code);
        return code;
      },
    );
    SAMPLES.forEach((sample, index) => run(`${sample}.constructor("return ${index}")`));
    expect(bodies).toEqual(["return 0", "return 1", "return 2"]);
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
      (code) => code,
    );
    expect(constructors()).toEqual(own);
  });

  it("never hands a constructor's native to a replaced Reflect.construct", () => {
    const { realm, run } = childRealm();
    installScriptExec(
      realm,
      (code) => code,
      (code) => code,
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
