import { describe, expect, it } from "vitest";
import { createInvoker } from "../src/client/invoke.ts";

describe("createInvoker", () => {
  it("calls natives through a function the target realm compiled", () => {
    const compiled: string[][] = [];
    const RealmFunction = function (...args: string[]) {
      compiled.push(args);
      return new Function(...args);
    } as unknown as FunctionConstructor;
    const invoke = createInvoker({ Function: RealmFunction });
    expect(invoke(Math.max, null, [1, 3])).toBe(3);
    expect(compiled).toEqual([["apply", "return function (f, t, a) { return apply(f, t, a); }"]]);
  });

  it("falls back to a direct call when the realm refuses to compile code", () => {
    const Refusing = function () {
      throw new EvalError("blocked");
    } as unknown as FunctionConstructor;
    expect(createInvoker({ Function: Refusing })(Math.min, null, [4, 2])).toBe(2);
  });
});
