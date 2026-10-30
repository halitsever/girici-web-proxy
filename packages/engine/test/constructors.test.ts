import { describe, expect, it, vi } from "vitest";
import { hookConstructor } from "../src/client/constructors.ts";

function nativeClass() {
  return class Native {
    readonly url: string;
    constructor(url: string) {
      this.url = url;
    }
  };
}

describe("hookConstructor", () => {
  it("hands the hook back to code that walks to the constructor", () => {
    const Native = nativeClass();
    const Hooked = hookConstructor(Native, (input) => [`hooked:${String(input[0])}`]);
    const viaPrototype = Object.getPrototypeOf(new Hooked("a")).constructor as typeof Native;
    expect(viaPrototype).toBe(Hooked);
    expect(new viaPrototype("b").url).toBe("hooked:b");
    expect(new Hooked("c")).toBeInstanceOf(Native);
  });

  it("keeps subclasses and an explicit new.target working", () => {
    const Hooked = hookConstructor(nativeClass(), (input) => [`hooked:${String(input[0])}`]);
    class Sub extends Hooked {}
    const sub = new Sub("a");
    expect(sub).toBeInstanceOf(Sub);
    expect(sub.url).toBe("hooked:a");
    const made = Reflect.construct(Hooked, ["b"], Sub) as Sub;
    expect(made).toBeInstanceOf(Sub);
    expect(made.url).toBe("hooked:b");
  });

  it("never hands the native to a replaced Reflect.construct", () => {
    const Native = nativeClass();
    const Hooked = hookConstructor(Native, (input) => input);
    const spy = vi.spyOn(Reflect, "construct").mockImplementation((target: unknown) => ({ leaked: target }));
    let made: unknown;
    try {
      made = new Hooked("a");
    } finally {
      spy.mockRestore();
    }
    expect(made).toBeInstanceOf(Native);
  });

  it("never hands the native to proxy traps a page adds to Object.prototype", () => {
    const Native = nativeClass();
    const Hooked = hookConstructor(Native, (input) => input) as unknown as () => unknown;
    const reflect = Reflect as unknown as Record<string, (...args: unknown[]) => unknown>;
    const proto = Object.prototype as Record<string, unknown>;
    const leaked: unknown[] = [];
    // One trap at a time: an inherited "get" also turns every property descriptor into an accessor.
    const probes: Array<[string, () => unknown]> = [
      ["get", () => Hooked.name],
      ["apply", () => Hooked()],
      ["has", () => "prototype" in Hooked],
      ["getPrototypeOf", () => Object.getPrototypeOf(Hooked)],
      ["getOwnPropertyDescriptor", () => Reflect.getOwnPropertyDescriptor(Hooked, "name")],
      ["ownKeys", () => Reflect.ownKeys(Hooked)],
    ];
    for (const [trap, probe] of probes) {
      proto[trap] = (target: unknown, ...rest: unknown[]) => {
        leaked.push(target);
        return reflect[trap]?.(target, ...rest);
      };
      try {
        probe();
      } catch {
        // A class cannot be called; only the trap lookup matters.
      } finally {
        delete proto[trap];
      }
    }
    expect(leaked).toEqual([]);
  });
});
