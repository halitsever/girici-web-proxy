import { describe, expect, it } from "vitest";
import { createFrameWalker } from "../src/client/frames.ts";

describe("createFrameWalker", () => {
  it("walks only when a mutation changed the number of child windows", () => {
    let count = 0;
    const adopted: unknown[] = [];
    const walker = createFrameWalker({ length: () => count, child: (i) => `w${i}`, adopt: (c) => adopted.push(c) });
    walker.after(() => undefined);
    expect(adopted).toEqual([]);
    walker.after(() => {
      count = 2;
    });
    expect(adopted).toEqual(["w0", "w1"]);
  });

  it("walks when a mutation swapped one child window for another", () => {
    let children = ["a"];
    const adopted: unknown[] = [];
    const walker = createFrameWalker({
      length: () => children.length,
      child: (i) => children[i],
      adopt: (c) => adopted.push(c),
    });
    walker.after(() => {
      children = ["b"];
    });
    expect(adopted).toEqual(["b"]);
  });

  it("walks after a mutation that threw part way", () => {
    let count = 0;
    const adopted: unknown[] = [];
    const walker = createFrameWalker({ length: () => count, child: (i) => i, adopt: (c) => adopted.push(c) });
    expect(() =>
      walker.after(() => {
        count = 1;
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(adopted).toEqual([0]);
  });

  it("returns what the mutation returned", () => {
    const walker = createFrameWalker({ length: () => 0, child: () => null, adopt: () => {} });
    expect(walker.after(() => 42)).toBe(42);
  });
});
