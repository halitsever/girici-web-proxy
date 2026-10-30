import { describe, expect, it } from "vitest";
import { installToStringMask, maskNative } from "../src/client/native-mask.ts";
import type { Realm } from "../src/client/url-context.ts";

const apply = Reflect.apply;

function setup() {
  const prototype = { toString: Function.prototype.toString };
  installToStringMask({ Function: { prototype } } as unknown as Realm);
  const native = function Native() {};
  const hooked = maskNative(() => {}, native);
  return { masked: prototype.toString, native, hooked };
}

describe("installToStringMask", () => {
  it("reports the native's source for a masked hook", () => {
    const { masked, native, hooked } = setup();
    expect(apply(masked, hooked, [])).toBe(Function.prototype.toString.call(native));
  });

  it("never hands the native to a replaced Function.prototype.call", () => {
    const { masked, hooked } = setup();
    const call = Object.getOwnPropertyDescriptor(Function.prototype, "call")!;
    const seen: unknown[] = [];
    Object.defineProperty(Function.prototype, "call", {
      ...call,
      value(this: unknown, self: unknown) {
        seen.push(self);
        return "";
      },
    });
    try {
      apply(masked, hooked, []);
    } finally {
      Object.defineProperty(Function.prototype, "call", call);
    }
    expect(seen).toEqual([]);
  });

  it("never hands a masked hook to a replaced WeakMap lookup", () => {
    const { masked, hooked } = setup();
    const get = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get")!;
    const seen: unknown[] = [];
    Object.defineProperty(WeakMap.prototype, "get", {
      ...get,
      value(this: WeakMap<object, unknown>, key: object) {
        seen.push(key);
        return apply(get.value as (key: object) => unknown, this, [key]);
      },
    });
    try {
      apply(masked, hooked, []);
    } finally {
      Object.defineProperty(WeakMap.prototype, "get", get);
    }
    expect(seen).toEqual([]);
  });
});
