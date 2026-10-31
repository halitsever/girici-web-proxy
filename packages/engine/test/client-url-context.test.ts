import { describe, expect, it } from "vitest";
import { createUrlContext, realUrlOf, type Realm } from "../src/client/url-context.ts";
import { hrefOf } from "../src/shared/primordials.ts";
import { createOriginSealer, MasterSealer } from "../src/shared/sealed-address.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

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

describe("sealed addresses", () => {
  const master = new MasterSealer(new Uint8Array(32).fill(2));
  const seal = master.originSeal("https://a.test");
  const own = createOriginSealer(seal)!;
  const page = new URL("https://a.test/dir/page?q=1");

  it("reads its real address from a sealed location", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}${own.seal(page)}#h`), undefined, seal);
    expect(ctx.realUrl().href).toBe(`${page.href}#h`);
    expect(ctx.opaque()).toBe(true);
    expect(ctx.toProxy("img.png")).toBe("/~/https/a.test/dir/img.png");
    expect(ctx.toProxy("?p=2")).toBe("?p=2");
    expect(ctx.fromProxy(`${proxy}${own.seal(new URL("https://a.test/x?y"))}`)).toBe("https://a.test/x?y");
  });

  it("addresses its own pages sealed and other sites plain", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}${own.seal(page)}`), undefined, seal);
    expect(ctx.documentAddress(new URL("https://a.test/n#k"))).toBe(own.seal(new URL("https://a.test/n#k")));
    expect(ctx.documentAddress(new URL("https://b.test/"))).toBe("/~/https/b.test/");
    expect(ctx.openSealed(own.seal(new URL("https://a.test/n"))!)?.href).toBe("https://a.test/n");
  });

  it("stays plain without a seal", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}/~/https/a.test/dir/page`));
    expect(ctx.opaque()).toBe(false);
    expect(ctx.documentAddress(new URL("https://a.test/n"))).toBe("/~/https/a.test/n");
    expect(ctx.openSealed(own.seal(page)!)).toBeNull();
    expect(ctx.toProxy("img.png")).toBe("img.png");
  });

  it("takes the seal of a renewed document", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}${own.seal(page)}`));
    expect(ctx.accepts(undefined)).toBe(false);
    expect(ctx.accepts(undefined, seal)).toBe(true);
    expect(ctx.accepts(undefined, master.originSeal("https://b.test"))).toBe(false);
    ctx.inherit(undefined, seal);
    expect(ctx.realUrl().href).toBe(page.href);
  });

  it("ignores a seal for another origin than the page's own", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}/~/https/a.test/p`), undefined, master.originSeal("https://b.test"));
    expect(ctx.documentAddress(new URL("https://b.test/x"))).toBe("/~/https/b.test/x");
    const sealedB = createUrlContext(
      fakeWin(`${proxy}${own.seal(page)}`),
      undefined,
      master.originSeal("https://b.test"),
    );
    expect(sealedB.openSealed(own.seal(page)!)).toBeNull();
  });

  it("reads a sealed location the same while a page has replaced built-ins", () => {
    const ctx = createUrlContext(fakeWin(`${proxy}${own.seal(page)}`), undefined, seal);
    const next = new URL("https://a.test/n");
    const expected = own.seal(next);
    for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
      withReplaced(target, key, replacement, () => {
        expect(hrefOf(ctx.realUrl()), name).toBe(page.href);
        expect(ctx.documentAddress(next), name).toBe(expected);
      });
    }
  });
});
