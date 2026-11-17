import { parseScript } from "meriyah";
import { describe, expect, it } from "vitest";
import { createHelpers } from "../src/client/helpers.ts";
import { rewriteJs } from "../src/rewrite/js.ts";

/** A window whose real location records every raw write, one named and indexed frame, and helpers over both. */
function setup() {
  const raw: unknown[] = [];
  const nativeLocation = {
    get href() {
      return "http://proxy.test/~/https/site.test/";
    },
    set href(value: unknown) {
      raw.push(value);
    },
  };
  const fake = { href: "https://site.test/", toString: () => fake.href };
  const frame = { name: "child" };
  const win: Record<PropertyKey, unknown> = { 0: frame, child: frame, length: 1, value: 1 };
  Object.defineProperty(win, "location", {
    get: () => nativeLocation,
    set: (value) => raw.push(value),
    enumerable: true,
  });
  const doc: Record<string, unknown> = {};
  Object.defineProperty(doc, "location", { get: () => nativeLocation, set: (value) => raw.push(value) });
  win.document = doc;
  win.window = win;
  win.self = win;
  win.frames = win;
  const windows = new Set<unknown>([win, frame]);
  const helpers = createHelpers({
    nativeLocation,
    fakeLocation: fake,
    isLocation: (value) => value === nativeLocation,
    fakeFor: () => null,
    isWindowOrDocument: (value) => value === win || value === doc,
    isWindow: (value) => windows.has(value),
    navigationUrl: (url) => `/~/proxied/${url}`,
    rewrite: {} as never,
    indirectEval: (code) => code,
    messageTarget: (value) => value,
    wrapWindow: (value) => (value === frame ? { wrapped: frame } : value),
    realOrigin: () => "https://site.test",
    site: () => undefined,
    renew: () => false,
  });
  /** Runs a rewritten classic script with `window`, `self`, `frames` and `document` bound as globals would be. */
  const run = (source: string): unknown => {
    const code = rewriteJs(source);
    expect(() => parseScript(code, { next: true, webcompat: true })).not.toThrow();
    // `out` takes the result, since a classic script has no return.
    return new Function("__g$", "window", "self", "frames", "document", "k", `var out; ${code}; return out;`).call(
      win,
      helpers,
      win,
      win,
      win,
      doc,
      "location",
    );
  };
  return { raw, fake, frame, win, doc, run };
}

describe("computed access on windows", () => {
  it.each([
    ['self["loc" + "ation"] = "https://evil.test/"'],
    ['window[k] = "https://evil.test/"'],
    ['document[k] = "https://evil.test/"'],
    ['self["loc" + "ation"].href = "https://evil.test/"'],
    ['"href" in window[k] ? (window[k].href = "https://evil.test/") : 0'],
    ['this[k] = "https://evil.test/"'],
    ['(() => { this[k] = "https://evil.test/"; })()'],
    ['[window[k]] = ["https://evil.test/"]'],
    ['({ a: window[k] } = { a: "https://evil.test/" })'],
    ['for (window[k] of ["https://evil.test/"]);'],
    ['window[k] ||= "https://evil.test/"; window[k] &&= "https://evil.test/"'],
    ['const { [k]: m } = window; m.href = "https://evil.test/"'],
    ['({ [k]: l } = window); l.href = "https://evil.test/"'],
    ['const { ...rest } = window; rest.location.href = "https://evil.test/"'],
    ['({ ...window }).location.href = "https://evil.test/"'],
    ['with (window) { location = "https://evil.test/"; }'],
    ['with (window) { location.href = "https://evil.test/"; }'],
  ])("keeps %s inside the proxy", (source) => {
    const { raw, fake, run } = setup();
    // The fake is a plain object, so a navigation through it shows up as its new href.
    run(`var l; ${source}`);
    expect(raw.every((value) => String(value).startsWith("/~/proxied/"))).toBe(true);
    expect([fake.href, ...raw].some((value) => String(value).includes("evil.test"))).toBe(true);
  });

  it("converts a compound write the way the page's operator would", () => {
    const { fake, run } = setup();
    run('window[k] += "#x"');
    expect(fake.href).toBe("https://site.test/#x");
  });

  it.each([
    ["frames[0]"],
    ["window[0]"],
    ['window["child"]'],
    ["window[frames.length - 1]"],
    ["self[`child`]"],
    ["window?.[0]"],
    ["window.frames[0]"],
  ])("wraps the frame %s reaches", (expression) => {
    const { frame, run } = setup();
    expect(run(`out = ${expression};`)).toEqual({ wrapped: frame });
  });

  it("wraps frames read through computed destructuring and spread", () => {
    const { frame, run } = setup();
    expect(run("const { [0]: a } = window; out = a;")).toEqual({ wrapped: frame });
    expect(run("out = { ...window }.child;")).toEqual({ wrapped: frame });
  });
});

describe("computed access on ordinary objects", () => {
  it.each([
    "arr[i]",
    "a[b] = c",
    "a[b] += c",
    "a[b]++",
    "delete a[b]",
    "b in a",
    "a?.[b]",
    "a[b](c)",
    "this.x[k]",
    "function f() { return this[k]; }",
    "class A { m() { return this[k]; } }",
    "const { [k]: v } = o",
    "({ ...o })",
  ])("leaves %s as written", (source) => {
    expect(rewriteJs(`location; ${source}`)).toBe(`__g$.L(location); ${source}`);
  });

  /** `window` here is a local the page bound to an ordinary object, so its accesses go through the helpers. */
  const local = (source: string, target: unknown, extra?: unknown): unknown => {
    const { run, win } = setup();
    win.__target = target;
    win.__extra = extra;
    return run(`out = (function (window, s) { ${source} })(this.__target, this.__extra);`);
  };

  it("keeps getters, setters and proxies working the way the page wrote them", () => {
    const log: unknown[] = [];
    const proxy = new Proxy({} as Record<PropertyKey, unknown>, {
      get: (_t, key) => (log.push(["get", key]), 1),
      set: (_t, key, value) => (log.push(["set", key, value]), true),
      has: (_t, key) => (log.push(["has", key]), false),
    });
    expect(local("window[s] = 5; return window[s] + window['x'];", proxy, "location")).toBe(2);
    expect(log).toEqual([
      ["set", "location", 5],
      ["get", "location"],
      ["get", "x"],
    ]);
    let stored = 0;
    const accessor = {
      get n() {
        return stored;
      },
      set n(value: number) {
        stored = value * 10;
      },
    };
    expect(local("window['n'] = 2; window['n'] += 1; window['n']++; return window['n'];", accessor)).toBe(2110);
  });

  it("keeps symbols, this for calls, optional chains and compound operators", () => {
    const symbol = Symbol("s");
    const wrapped = (source: string, target: unknown) => local(source, target, symbol);
    const target = {
      [symbol]: 1,
      count: 1,
      method() {
        return this;
      },
    };
    expect(wrapped("window[s] += 1; return window[s];", target)).toBe(2);
    expect(wrapped("const m = 'method'; return window[m]() === window;", target)).toBe(true);
    expect(wrapped("return window?.['missing']?.x;", target)).toBeUndefined();
    expect(wrapped("return window?.[0].x;", null)).toBeUndefined();
    expect(wrapped("window['count'] **= 3; window['count'] <<= 1; return window['count']--;", { count: 2 })).toBe(16);
    expect(wrapped("let i = 0; window[i++] = i; return [window[0], i];", [])).toEqual([1, 1]);
    expect(
      wrapped("return new window['C'](2).v;", {
        C: function (this: { v: number }, v: number) {
          this.v = v;
        },
      }),
    ).toBe(2);
  });
});
