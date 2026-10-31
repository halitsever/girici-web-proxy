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
    navigationUrl: (raw) => (raw.startsWith("blob:") ? `blob:boot/${raw}` : `/~/proxied/${raw}`),
    rewrite: {
      js: (c) => c,
      jsBody: (c) => c,
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
    for (const key of ["parent", "top", "opener", "frames"]) expect(view[key]).toEqual({ wrapped: frame });
    expect(view.name).toBe(frame);
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

  it("routes eval, html and import helpers through the bridge", () => {
    const nativeLocation = { href: "http://proxy.test/~/https/site.test/" };
    const evaled: string[] = [];
    const helpers = createHelpers({
      nativeLocation,
      fakeLocation: { href: "https://site.test/" },
      isLocation: (value) => value === nativeLocation,
      fakeFor: () => null,
      isWindowOrDocument: () => false,
      navigationUrl: (raw) => `/~/proxied/${raw}`,
      rewrite: {
        js: (c) => `/*rw*/${c}`,
        jsBody: (c) => `/*rw*/${c}`,
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
