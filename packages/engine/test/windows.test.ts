import { describe, expect, it } from "vitest";
import type { Invoke } from "../src/client/invoke.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { createWindowGuard, realOriginOf } from "../src/client/windows.ts";
import { DESCRIPTOR_ADDITIONS, REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const proxy = "http://proxy.test";
const direct: Invoke = (fn, self, args) => Reflect.apply(fn, self, args);

type FakeWindow = Record<string, unknown> & { location: { href: string } };

function fakeWindow(href: string, origin = "", extra: Record<string, unknown> = {}): FakeWindow {
  const win: FakeWindow = {
    location: { href },
    origin,
    postMessage: () => {},
    close: () => {},
    closed: false,
    focus: () => {},
    blur: () => {},
    ...extra,
  };
  win.window = win;
  win.self = win;
  return win;
}

function guardFor(realOrigin: string, invoke: Invoke = direct, navigated: string[] = []) {
  // A realm's own window getters, which read whatever window they are applied to.
  const win = { DOMException, postMessage: () => {} } as unknown as Realm;
  for (const name of ["closed", "length", "top", "parent", "opener"]) {
    Object.defineProperty(win, name, {
      get(this: Record<string, unknown>) {
        return this[name];
      },
    });
  }
  const ctx = {
    origin: proxy,
    realUrl: () => new URL(`${realOrigin}/page`),
    toProxy: (raw: string) => {
      navigated.push(raw);
      return `${proxy}/~/proxied/${raw}`;
    },
  } as unknown as UrlContext;
  return createWindowGuard(win, ctx, invoke);
}

describe("realOriginOf", () => {
  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`reads real origins when ${name} is replaced`, () => {
      const framed = fakeWindow(`${proxy}/~/https/b.test/x?y`);
      const blank = fakeWindow("about:blank", proxy, { __g$: { realOrigin: () => "https://a.test" } });
      const read = () => [realOriginOf(framed, proxy), realOriginOf(blank, proxy)];
      expect(withReplaced(target, key, replacement, read)).toEqual(["https://b.test", "https://a.test"]);
    });
  }

  it("reads the proxy address first, then the window's own runtime", () => {
    expect(realOriginOf(fakeWindow(`${proxy}/~/https/b.test/x?y`), proxy)).toBe("https://b.test");
    const blank = fakeWindow("about:blank", proxy, { __g$: { realOrigin: () => "https://a.test" } });
    expect(realOriginOf(blank, proxy)).toBe("https://a.test");
    // The origin property can be redefined by the window's own page, so it is never asked.
    expect(realOriginOf(fakeWindow("about:blank", "https://a.test"), proxy)).toBeNull();
    expect(realOriginOf(fakeWindow("about:blank", proxy, { __g$: { realOrigin: () => proxy } }), proxy)).toBeNull();
    expect(realOriginOf({}, proxy)).toBeNull();
  });
});

describe("createWindowGuard", () => {
  it("leaves same-origin windows alone and restricts others", () => {
    const guard = guardFor("https://a.test");
    const same = fakeWindow(`${proxy}/~/https/a.test/x`);
    const other = fakeWindow(`${proxy}/~/https/b.test/`);
    expect(guard.wrap(same)).toBe(same);
    const wrapped = guard.wrap(other) as Record<string, unknown>;
    expect(guard.wrap(other)).toBe(wrapped);
    expect(guard.wrap(wrapped)).toBe(wrapped);
    expect(() => wrapped.document).toThrow(/SecurityError|Blocked/);
    expect(wrapped.closed).toBe(false);
    expect((wrapped as { then?: unknown }).then).toBeUndefined();
  });

  it("restricts a window whose real origin cannot be told", () => {
    const guard = guardFor("https://a.test");
    expect(guard.isWrapper(guard.wrap(fakeWindow("about:blank", proxy)))).toBe(true);
  });

  it("posts through the invoker with the target's real origin translated", () => {
    const calls: unknown[][] = [];
    const guard = guardFor("https://a.test", (_fn, _self, args) => calls.push([...args]));
    const other = guard.wrap(fakeWindow(`${proxy}/~/https/b.test/`)) as Window;
    other.postMessage("hi", "https://b.test");
    other.postMessage("no", "https://c.test");
    expect(calls).toEqual([["hi", proxy]]);
  });

  it("returns non-windows as they are", () => {
    const guard = guardFor("https://a.test");
    const port = { postMessage() {} };
    for (const value of [null, undefined, 1, "x", port]) expect(guard.wrap(value)).toBe(value);
    expect(guard.isWrapper(port)).toBe(false);
  });

  it("restricts a same-origin window headed to another origin", () => {
    const guard = guardFor("https://a.test");
    const blank = fakeWindow("about:blank", proxy, { __g$: { realOrigin: () => "https://a.test" } });
    expect(guard.wrap(blank, "https://a.test")).toBe(blank);
    const popup = fakeWindow("about:blank", proxy, { __g$: { realOrigin: () => "https://a.test" } });
    expect(guard.isWrapper(guard.wrap(popup, "https://b.test"))).toBe(true);
  });

  it("keeps each window's first answer until the document changes", () => {
    const guard = guardFor("https://a.test");
    const child = fakeWindow(`${proxy}/~/https/a.test/blank`);
    expect(guard.wrap(child)).toBe(child);
    child.location.href = `${proxy}/~/https/b.test/`;
    expect(guard.wrap(child)).toBe(child);
    guard.reset();
    expect(guard.isWrapper(guard.wrap(child))).toBe(true);
  });

  it("gives full access through a wrapper while its window shows this origin", () => {
    const guard = guardFor("https://a.test");
    const popup = fakeWindow(`${proxy}/~/https/b.test/`, "", { document: "doc" });
    const wrapped = guard.wrap(popup) as Record<string, unknown>;
    expect(() => wrapped.document).toThrow(/SecurityError|Blocked/);
    popup.location.href = `${proxy}/~/https/a.test/callback`;
    expect(wrapped.document).toBe("doc");
    expect(guard.wrap(popup)).toBe(wrapped);
  });

  it("wraps the windows a restricted window links to", () => {
    const guard = guardFor("https://a.test");
    const same = fakeWindow(`${proxy}/~/https/a.test/`);
    const other = fakeWindow(`${proxy}/~/https/b.test/`, "", { parent: same, top: same, opener: null, 0: same });
    const third = fakeWindow(`${proxy}/~/https/c.test/`);
    other.frames = other;
    other.length = 1;
    const wrapped = guard.wrap(other) as Record<string | number, unknown>;
    expect(wrapped.window).toBe(wrapped);
    expect(wrapped.self).toBe(wrapped);
    expect(wrapped.frames).toBe(wrapped);
    expect(wrapped.parent).toBe(same);
    expect(wrapped.opener).toBeNull();
    expect(wrapped[0]).toBe(same);
    expect(wrapped.length).toBe(1);
    other.parent = third;
    expect(guard.isWrapper(wrapped.parent)).toBe(true);
    expect(() => {
      wrapped.name = "x";
    }).toThrow(/SecurityError|Blocked/);
    expect(() => Object.defineProperty(wrapped, "x", { value: 1 })).toThrow(/SecurityError|Blocked/);
  });

  it("navigates a restricted window but never reads its address", () => {
    const navigated: string[] = [];
    const set: unknown[] = [];
    const guard = guardFor("https://a.test", direct, navigated);
    const target = fakeWindow(`${proxy}/~/https/b.test/`);
    const nativeLocation = {
      replace: (url: string) => set.push(["replace", url]),
    };
    Object.defineProperty(nativeLocation, "href", {
      get: () => target.location.href,
      set: (url: string) => set.push(["href", url]),
    });
    target.location = nativeLocation as unknown as { href: string };
    const wrapped = guard.wrap(target) as { location: { href: string; replace(url: string): void } };
    expect(() => wrapped.location.href).toThrow(/SecurityError|Blocked/);
    wrapped.location.href = "https://c.test/";
    wrapped.location.replace("/d");
    (wrapped as unknown as Record<string, unknown>).location = "https://e.test/";
    expect(navigated).toEqual(["https://c.test/", "/d", "https://e.test/"]);
    expect(set).toEqual([
      ["href", `${proxy}/~/proxied/https://c.test/`],
      ["replace", `${proxy}/~/proxied//d`],
      ["href", `${proxy}/~/proxied/https://e.test/`],
    ]);
  });

  it("describes a wrapper's members whatever the page added to Object.prototype", () => {
    const guard = guardFor("https://a.test");
    const wrapped = guard.wrap(fakeWindow(`${proxy}/~/https/b.test/`)) as object;
    const described = withPrototypeAdditions(DESCRIPTOR_ADDITIONS, () =>
      Object.getOwnPropertyDescriptor(wrapped, "closed"),
    );
    expect(described).toMatchObject({ value: false, configurable: true });
  });

  it("ignores proxy traps a page adds to Object.prototype", () => {
    const guard = guardFor("https://a.test");
    const wrapped = guard.wrap(fakeWindow(`${proxy}/~/https/b.test/`)) as object;
    const proto = Object.prototype as Record<string, unknown>;
    let trapped = false;
    proto.has = () => {
      trapped = true;
      return true;
    };
    try {
      void ("location" in wrapped);
    } finally {
      delete proto.has;
    }
    expect(trapped).toBe(false);
  });
});
