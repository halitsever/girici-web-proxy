import { describe, expect, it } from "vitest";
import { hookConstructor } from "../src/client/constructors.ts";

describe("hookConstructor", () => {
  it("hands the hook back to code that walks to the constructor", () => {
    class Native {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
      }
    }
    const Hooked = hookConstructor(Native, (input) => [`hooked:${String(input[0])}`]);
    const viaPrototype = Object.getPrototypeOf(new Hooked("a")).constructor as typeof Native;
    expect(viaPrototype).toBe(Hooked);
    expect(new viaPrototype("b").url).toBe("hooked:b");
    expect(new Hooked("c")).toBeInstanceOf(Native);
  });
});
