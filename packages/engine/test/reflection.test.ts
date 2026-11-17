import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installReflection } from "../src/client/reflection.ts";
import type { Realm } from "../src/client/url-context.ts";

/** A fresh realm with a fake window and document on it, so the hooks never touch this test's own builtins. */
function setup() {
  const realm = runInContext("globalThis", createContext()) as Realm & Record<string, unknown>;
  const raw: unknown[] = [];
  const navigated: Array<[unknown, unknown]> = [];
  const nativeLocation = { href: "http://proxy.test/~/https/site.test/" };
  const fake = { href: "https://site.test/" };
  const frame = { name: "child" };
  const wrapped = { wrapped: frame };
  const win: Record<PropertyKey, unknown> = { 0: frame, value: 1 };
  Object.defineProperty(win, "location", {
    get: function location() {
      return nativeLocation;
    },
    set: (value) => raw.push(value),
    enumerable: true,
    configurable: false,
  });
  Object.defineProperty(win, "top", { get: () => frame, enumerable: true, configurable: false });
  const doc: Record<string, unknown> = {};
  Object.defineProperty(doc, "location", { get: () => nativeLocation, set: (value) => raw.push(value) });
  const other: Record<string, unknown> = {};
  Object.defineProperty(other, "location", {
    get: () => nativeLocation,
    set: (value) => raw.push(value),
    enumerable: true,
  });
  const windows = new Set<unknown>([win, doc, other]);
  installReflection(realm, {
    settle: (value) => (value === nativeLocation ? fake : value === frame ? wrapped : value),
    navigate: (target, url) => navigated.push([target, url]),
    isWindowOrDocument: (value) => windows.has(value),
    nativeLocation,
    isOwn: (value) => value === win || value === doc,
  });
  const { Reflect: R, Object: O } = realm as unknown as { Reflect: typeof Reflect; Object: ObjectConstructor };
  return { R, O, realm, raw, navigated, nativeLocation, fake, frame, wrapped, win, doc, other };
}

describe("installReflection", () => {
  it("reads a window's location and frames through Reflect.get as their stand-ins", () => {
    const { R, win, doc, other, fake, wrapped } = setup();
    expect(R.get(win, "location")).toBe(fake);
    expect(R.get(win, { toString: () => "location" } as unknown as PropertyKey)).toBe(fake);
    expect(R.get(doc, "location")).toBe(fake);
    expect(R.get(other, "location")).toBe(fake);
    expect(R.get(win, 0)).toBe(wrapped);
    expect(R.get(win, "top")).toBe(wrapped);
    expect(R.get(win, "value")).toBe(1);
  });

  it("navigates through Reflect.set only for a write to the window itself", () => {
    const { R, win, doc, other, navigated, raw } = setup();
    expect(R.set(win, "location", "https://evil.test/")).toBe(true);
    expect(R.set(doc, "location", "d")).toBe(true);
    expect(R.set(other, "location", "o", other)).toBe(true);
    expect(navigated).toEqual([
      [win, "https://evil.test/"],
      [doc, "d"],
      [other, "o"],
    ]);
    // Another receiver runs the native setter on that receiver, as the browser would.
    const receiver = {};
    R.set(win, "location", "r", receiver);
    expect(raw).toEqual(["r"]);
    expect(R.set(win, "value", 2)).toBe(true);
    expect(win.value).toBe(2);
  });

  it("hands out location accessors that read the stand-in and navigate inside the proxy", () => {
    const { R, O, win, doc, fake, navigated, raw } = setup();
    for (const describe of [O.getOwnPropertyDescriptor, R.getOwnPropertyDescriptor]) {
      const descriptor = describe(win, "location") as PropertyDescriptor;
      expect(descriptor.get?.call(win)).toBe(fake);
      descriptor.set?.call(win, "https://evil.test/");
      expect(descriptor.get).toBe((describe(win, "location") as PropertyDescriptor).get);
      expect(descriptor.get?.name).toBe("location");
      expect(descriptor.enumerable).toBe(true);
      expect(descriptor.configurable).toBe(false);
    }
    const all = O.getOwnPropertyDescriptors(doc);
    expect(all.location?.get?.call(doc)).toBe(fake);
    expect(navigated).toEqual([
      [win, "https://evil.test/"],
      [win, "https://evil.test/"],
    ]);
    expect(raw).toEqual([]);
  });

  it("settles values and the top getter from this window's descriptors", () => {
    const { O, win, wrapped } = setup();
    expect(O.getOwnPropertyDescriptor(win, "0")?.value).toBe(wrapped);
    expect(O.getOwnPropertyDescriptor(win, "top")?.get?.call(win)).toBe(wrapped);
    expect(O.getOwnPropertyDescriptors(win)[0]?.value).toBe(wrapped);
  });

  it("navigates through Object.assign and settles what it copies from a window", () => {
    const { O, win, other, fake, wrapped, navigated } = setup();
    const result = O.assign(win, { location: "https://evil.test/", value: 3 });
    expect(result).toBe(win);
    expect(win.value).toBe(3);
    O.assign(other, { location: "o" });
    expect(navigated).toEqual([
      [win, "https://evil.test/"],
      [other, "o"],
    ]);
    const copy = O.assign({}, win) as Record<PropertyKey, unknown>;
    expect(copy.location).toBe(fake);
    expect(copy[0]).toBe(wrapped);
  });

  it("settles Object.values and Object.entries of a window", () => {
    const { O, win, other, fake, wrapped } = setup();
    expect(O.values(win)).toEqual([wrapped, 1, fake, wrapped]);
    expect(O.entries(other)).toEqual([["location", fake]]);
  });

  it("hands out the stand-in accessors from __lookupGetter__ and __lookupSetter__", () => {
    const { O, win, fake, navigated } = setup();
    const proto = O.prototype as unknown as {
      __lookupGetter__(this: unknown, key: string): (() => unknown) | undefined;
      __lookupSetter__(this: unknown, key: string): ((value: unknown) => void) | undefined;
    };
    expect(proto.__lookupGetter__.call(win, "location")?.call(win)).toBe(fake);
    proto.__lookupSetter__.call(win, "location")?.call(win, "https://evil.test/");
    expect(navigated).toEqual([[win, "https://evil.test/"]]);
  });

  it("leaves ordinary objects, getters, setters and proxies as the natives treat them", () => {
    const { R, O } = setup();
    const log: unknown[] = [];
    const proxy = new Proxy(
      { location: 1 },
      {
        get: (target, key, receiver) => (log.push(["get", key]), Reflect.get(target, key, receiver)),
        set: (target, key, value, receiver) => (log.push(["set", key]), Reflect.set(target, key, value, receiver)),
        has: (target, key) => (log.push(["has", key]), key in target),
        getOwnPropertyDescriptor: (target, key) => (
          log.push(["gopd", key]),
          Reflect.getOwnPropertyDescriptor(target, key)
        ),
        ownKeys: (target) => (log.push(["keys"]), Reflect.ownKeys(target)),
      },
    );
    expect(R.get(proxy, "location")).toBe(1);
    expect(R.set(proxy, "location", 2)).toBe(true);
    expect(O.getOwnPropertyDescriptor(proxy, "location")?.value).toBe(2);
    expect(O.assign({}, proxy)).toEqual({ location: 2 });
    expect(log).toEqual([
      ["get", "location"],
      ["set", "location"],
      // The native set looks the key up on its receiver, the proxy.
      ["gopd", "location"],
      ["gopd", "location"],
      // Object.assign asks a source whether it holds location before deciding to check the target.
      ["gopd", "location"],
      ["keys"],
      ["gopd", "location"],
      ["get", "location"],
    ]);
    const symbol = Symbol("s");
    const target = {
      [symbol]: 1,
      get self() {
        return this;
      },
    };
    const receiver = {};
    expect(R.get(target, "self", receiver)).toBe(receiver);
    expect(R.get(target, symbol)).toBe(1);
    expect(() => R.get(1 as never, "x")).toThrow(/non-object/);
    expect(() => O.assign(null as never, {})).toThrow(/null/);
    expect(O.assign({ a: 1 }, null, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(O.values("ab")).toEqual(["a", "b"]);
    const frozen = Object.freeze({ a: 1 });
    expect(() => O.assign(frozen, { a: 2 })).toThrow(/read only/);
    expect([R.get.name, R.get.length, O.assign.name, O.assign.length]).toEqual(["get", 2, "assign", 2]);
  });
});
