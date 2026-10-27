import { describe, expect, it } from "vitest";
import { createHelpers } from "../src/client/helpers.ts";

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
    toProxy: (raw) => `/~/proxied/${raw}`,
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
});
