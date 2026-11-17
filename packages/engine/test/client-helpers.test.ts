import { describe, expect, it } from "vitest";
import { createHelpers } from "../src/client/helpers.ts";
import { withReplaced } from "./replaced-builtins.ts";

function setup() {
  const nativeLocation = { href: "http://proxy.test/~/https/site.test/" };
  const frameLocation = { href: "http://proxy.test/~/https/frame.test/" };
  const fake: Record<string, unknown> = { href: "https://site.test/" };
  const frameFake: Record<string, unknown> = { href: "https://frame.test/" };
  const win = { location: nativeLocation, document: { location: nativeLocation } };
  const frame = { location: frameLocation };
  const helpers = createHelpers({
    nativeLocation,
    fakeLocation: fake,
    isLocation: (value) => value === nativeLocation || value === frameLocation,
    fakeFor: (location) => (location === frameLocation ? frameFake : null),
    isWindowOrDocument: (value) => value === win || value === win.document || value === frame,
    isWindow: (value) => value === win || value === frame,
    navigationUrl: (raw) => (raw.startsWith("blob:") ? `blob:boot/${raw}` : `/~/proxied/${raw}`),
    rewrite: {
      js: (c) => c,
      jsBody: (c) => c,
      jsFunction: (params, body) => ({ params, body }),
      html: (h) => h,
      unhtml: (h) => h,
      srcdoc: (h) => `<script data-engine></script>${h}`,
      unsrcdoc: (h) => h,
      importSpecifier: (s) => s,
      metaUrl: (u) => u,
    },
    indirectEval: (code) => (code === "'doc'" ? "<p>doc</p>" : undefined),
    messageTarget: (value) => value,
    wrapWindow: (value) => (value === frame ? { wrapped: value } : value),
    realOrigin: () => "https://site.test",
    site: () => "https://site.test",
    renew: () => false,
  });
  return { helpers, nativeLocation, frameLocation, fake, frameFake, win, frame };
}

describe("createHelpers", () => {
  it("L swaps real locations for fakes and passes everything else", () => {
    const { helpers, nativeLocation, frameLocation, fake, frameFake } = setup();
    const plain = { a: 1 };
    expect(helpers.L(nativeLocation)).toBe(fake);
    expect(helpers.L(frameLocation)).toBe(frameFake);
    expect(helpers.L(plain)).toBe(plain);
    expect(helpers.L("x")).toBe("x");
    expect(helpers.L(undefined)).toBeUndefined();
  });

  it("N proxies assignments to the real location only", () => {
    const { helpers, nativeLocation } = setup();
    expect(helpers.N(nativeLocation, "https://x.test/")).toBe("/~/proxied/https://x.test/");
    expect(helpers.N(nativeLocation, { toString: () => "u" })).toBe("/~/proxied/u");
    expect(helpers.N(5, 7)).toBe(7);
  });

  it("N swaps a blob URL for its bootstrap, as every other navigation sink does", () => {
    const { helpers, nativeLocation } = setup();
    expect(helpers.N(nativeLocation, "blob:http://p.test/1")).toBe("blob:boot/blob:http://p.test/1");
  });

  it("A reads a window's location as a read would and writes it as S does", () => {
    const { helpers, fake, win } = setup();
    const target = helpers.A(win);
    expect(target.v).toBe(fake);
    target.v = "c";
    expect(fake.href).toBe("c");
    const plain: Record<string, unknown> = { location: 0 };
    const other = helpers.A(plain);
    expect(other.v).toBe(0);
    other.v = 2;
    expect(plain.location).toBe(2);
  });

  it("S navigates windows and documents and assigns everything else", () => {
    const { helpers, fake, frameFake, win, frame } = setup();
    expect(helpers.S(win, "location", "https://x.test/")).toBe("https://x.test/");
    expect(fake.href).toBe("https://x.test/");
    helpers.S(win.document, "location", "y");
    expect(fake.href).toBe("y");
    helpers.S(frame, "location", "z");
    expect(frameFake.href).toBe("z");
    const plain: Record<string, unknown> = {};
    expect(helpers.S(plain, "location", 1)).toBe(1);
    expect(plain.location).toBe(1);
  });

  it("D exposes the fake location to destructuring", () => {
    const { helpers, fake, win } = setup();
    const plain = { location: 1 };
    expect((helpers.D(win) as typeof win).location).toBe(fake);
    expect((helpers.D(win) as typeof win).document).toBe(win.document);
    expect(helpers.D(plain)).toBe(plain);
  });

  it("W delegates to the env's wrapWindow", () => {
    const { helpers, frame, win } = setup();
    expect(helpers.W(frame)).toEqual({ wrapped: frame });
    expect(helpers.W(win)).toBe(win);
    expect(helpers.W(5)).toBe(5);
    expect(helpers.realOrigin()).toBe("https://site.test");
    expect(helpers.site()).toBe("https://site.test");
  });

  it("D never hands the window to a Proxy the page replaced", () => {
    const { helpers, win } = setup();
    const seen: unknown[] = [];
    const NativeProxy = Proxy;
    const PageProxy = function (target: object, handler: ProxyHandler<object>) {
      seen.push(target, handler);
      return new NativeProxy(target, handler);
    };
    const view = withReplaced(globalThis, "Proxy", { value: PageProxy }, () => helpers.D(win)) as typeof win;
    expect(seen).toEqual([]);
    expect(view.document).toBe(win.document);
  });

  it("wraps window links read through destructuring when Reflect.get is replaced", () => {
    const { helpers, win, frame } = setup();
    const withLinks = Object.assign(win, { parent: frame });
    const view = helpers.D(withLinks) as Record<string, unknown>;
    const read = withReplaced(Reflect, "get", { value: () => "page" }, () => [view.parent, view.location]);
    expect(read).toEqual([{ wrapped: frame }, { href: "https://site.test/" }]);
  });

  it("wraps window links read through destructuring", () => {
    const { helpers, win, frame } = setup();
    const withLinks = Object.assign(win, { parent: frame, top: frame, opener: frame, frames: frame, name: frame });
    const view = helpers.D(withLinks) as Record<string, unknown>;
    for (const key of ["parent", "top", "opener", "frames", "name"]) expect(view[key]).toEqual({ wrapped: frame });
    expect(view.document).toBe(win.document);
  });

  it("D ignores proxy traps a page adds to Object.prototype", () => {
    const { helpers, win } = setup();
    const proto = Object.prototype as Record<string, unknown>;
    let trapped: unknown = null;
    proto.has = (target: object) => {
      trapped = target;
      return false;
    };
    try {
      void ("location" in (helpers.D(win) as object));
    } finally {
      delete proto.has;
    }
    expect(trapped).toBeNull();
  });

  it("V swaps real locations and wraps other windows, and passes everything else", () => {
    const { helpers, nativeLocation, fake, frame, win } = setup();
    const plain = { a: 1 };
    const fn = () => {};
    expect(helpers.V(nativeLocation)).toBe(fake);
    expect(helpers.V(frame)).toEqual({ wrapped: frame });
    expect(helpers.V(win)).toBe(win);
    for (const value of [plain, fn, 1, "s", null, undefined]) expect(helpers.V(value)).toBe(value);
  });

  it("K writes location as S does and every other key as the page wrote it", () => {
    const { helpers, fake, win, frame } = setup();
    helpers.K(win, { toString: () => "location" }).v = "https://x.test/";
    expect(fake.href).toBe("https://x.test/");
    helpers.K(win.document, "location").v = "y";
    expect(fake.href).toBe("y");
    expect(helpers.K(win, "location").v).toBe(fake);
    const named = Object.assign(win, { child: frame });
    expect(helpers.K(named, "child").v).toEqual({ wrapped: frame });
    const plain: Record<PropertyKey, unknown> = { location: 1 };
    helpers.K(plain, "location").v = 2;
    expect(plain.location).toBe(2);
  });

  it("K converts its key once and keeps sloppy writes from throwing", () => {
    const { helpers } = setup();
    let conversions = 0;
    const key = {
      toString: () => {
        conversions++;
        return "n";
      },
    };
    const target: Record<string, number> = { n: 1 };
    const ref = helpers.K(target, key);
    ref.v = (ref.v as number) + 1;
    expect(target.n).toBe(2);
    expect(conversions).toBe(1);
    const frozen = Object.freeze({ n: 1 });
    expect(() => (helpers.K(frozen, "n").v = 2)).not.toThrow();
    expect(() => (helpers.K(5, "n").v = 2)).not.toThrow();
    expect(() => (helpers.K(null, "n").v = 2)).toThrow(TypeError);
    expect(() => helpers.K(undefined, "n").v).toThrow(TypeError);
  });

  it("routes eval, html and import helpers through the bridge", () => {
    const nativeLocation = { href: "http://proxy.test/~/https/site.test/" };
    const evaled: string[] = [];
    const helpers = createHelpers({
      nativeLocation,
      fakeLocation: { href: "https://site.test/" },
      isLocation: (value) => value === nativeLocation,
      fakeFor: () => null,
      isWindowOrDocument: () => false,
      isWindow: () => false,
      navigationUrl: (raw) => `/~/proxied/${raw}`,
      rewrite: {
        js: (c) => `/*rw*/${c}`,
        jsBody: (c) => `/*rw*/${c}`,
        jsFunction: (params, body) => ({ params, body }),
        html: (h) => `/*rw*/${h}`,
        unhtml: (h) => h,
        srcdoc: (h) => h,
        unsrcdoc: (h) => h,
        importSpecifier: (s) => `proxied:${s}`,
        metaUrl: (u) => `real:${u}`,
      },
      indirectEval: (code) => {
        evaled.push(String(code));
        return "result";
      },
      messageTarget: (value) => ({ standIn: value }),
      wrapWindow: (value) => value,
      realOrigin: () => "https://site.test",
      site: () => "https://site.test",
      renew: () => true,
    });
    expect(helpers.E("location")).toBe("/*rw*/location");
    expect(helpers.E(42)).toBe(42);
    expect(helpers.ev("location")).toBe("result");
    expect(evaled).toEqual(["/*rw*/location"]);
    expect(helpers.I("m.js")).toBe("proxied:m.js");
    expect(helpers.H("<a>x</a>")).toBe("/*rw*/<a>x</a>");
    expect(helpers.M("/~/x")).toBe("real:/~/x");
    expect(helpers.P("w")).toEqual({ standIn: "w" });
    expect(helpers.renew()).toBe(true);
  });

  it("J runs a javascript: URL's code and puts the runtime in front of a document it makes", () => {
    const { helpers } = setup();
    expect(helpers.J("'doc'", "https://site.test")).toBe("<script data-engine></script><p>doc</p>");
    expect(helpers.J("void 0", "https://site.test")).toBeUndefined();
  });

  it("J runs nothing for a javascript: URL another origin wrote", () => {
    const { helpers } = setup();
    expect(helpers.J("'doc'", "https://other.test")).toBeUndefined();
    expect(helpers.J("'doc'")).toBeUndefined();
  });
});
