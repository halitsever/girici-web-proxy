import { describe, expect, it } from "vitest";
import { createUrlContext, realUrlOf, type Realm } from "../src/client/url-context.ts";

const proxy = "http://proxy.test";

function fakeWin(href: string) {
  return { location: { href, origin: proxy }, Node: { prototype: {} } } as unknown as Realm & {
    location: { href: string };
  };
}

describe("realUrlOf", () => {
  it("decodes proxy addresses only", () => {
    expect(realUrlOf(`${proxy}/~/https/a.test/x?y#z`, proxy)?.href).toBe("https://a.test/x?y#z");
    expect(realUrlOf("about:blank", proxy)).toBeNull();
    expect(realUrlOf("http://other.test/~/https/a.test/", proxy)).toBeNull();
    expect(realUrlOf(`${proxy}/~/https//a.test/`, proxy)).toBeNull();
  });

  it("reads addresses the same way after page code replaced URL getters and String methods", () => {
    const proto = URL.prototype as unknown as Record<string, unknown>;
    const origin = Object.getOwnPropertyDescriptor(URL.prototype, "origin") as PropertyDescriptor;
    const slice = String.prototype.slice;
    Object.defineProperty(URL.prototype, "origin", { configurable: true, get: () => proxy });
    String.prototype.slice = () => "https/b.test/";
    try {
      expect(realUrlOf(`${proxy}/~/https/a.test/x`, proxy)?.hostname).toBe("a.test");
      expect(realUrlOf("https://b.test/", proxy)).toBeNull();
    } finally {
      Object.defineProperty(proto, "origin", origin);
      String.prototype.slice = slice;
    }
  });
});

describe("createUrlContext", () => {
  it("keeps the inherited origin of a window without a proxy address", () => {
    const win = fakeWin("about:blank");
    const ctx = createUrlContext(win, { origin: proxy, base: "https://a.test/page" });
    expect(ctx.accepts({ origin: proxy, base: "https://a.test/other" })).toBe(true);
    expect(ctx.accepts({ origin: proxy, base: "https://b.test/" })).toBe(false);
    expect(ctx.accepts(undefined)).toBe(false);
  });

  it("accepts any document that loads at a proxy address of its own", () => {
    const win = fakeWin("about:blank");
    const ctx = createUrlContext(win, { origin: proxy, base: "https://a.test/page" });
    win.location.href = `${proxy}/~/https/b.test/`;
    expect(ctx.accepts(undefined)).toBe(true);
    ctx.inherit(undefined);
    expect(ctx.realUrl().href).toBe("https://b.test/");
  });
});
