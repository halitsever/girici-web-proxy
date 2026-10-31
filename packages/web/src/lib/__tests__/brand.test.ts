import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyBrandToDocument,
  brand,
  fetchBrand,
  LOGO_ERROR,
  parseBrand,
  readLogoFile,
  saveBrand,
  type BrandDocument,
  type BrandElement,
} from "../brand";

afterEach(() => vi.unstubAllGlobals());

interface FakeLink extends BrandElement {
  rel: string;
  href: string;
}

/** A document that records its head's links and answers the three selectors the brand code uses. */
function fakeDocument(): BrandDocument & { links: FakeLink[] } {
  const links: FakeLink[] = [];
  const make = (rel: string, href: string, id = ""): FakeLink => {
    const element: FakeLink = {
      id,
      rel,
      href,
      setAttribute(name, value) {
        if (name === "rel") element.rel = value;
        if (name === "href") element.href = value;
      },
      remove() {
        const index = links.indexOf(element);
        if (index >= 0) links.splice(index, 1);
      },
    };
    return element;
  };
  links.push(
    make("icon", "/favicon.svg"),
    make("icon", "/favicon-32.png"),
    make("icon", "/favicon-16.png"),
    make("apple-touch-icon", "/apple.png"),
  );
  return {
    title: "Girici",
    links,
    head: { appendChild: (element) => links.push(element as FakeLink) },
    createElement: () => make("", ""),
    querySelectorAll(selector) {
      if (selector === "#brand-icon") return links.filter((link) => link.id === "brand-icon");
      if (selector === 'link[rel~="icon"]') return links.filter((link) => link.rel.split(" ").includes("icon"));
      if (selector === 'link[rel="apple-touch-icon"]') return links.filter((link) => link.rel === "apple-touch-icon");
      return [];
    },
  };
}

describe("brand", () => {
  it("falls back to Girici when the server has no brand or cannot answer", async () => {
    expect(parseBrand({ name: null, logo: null })).toEqual({ name: "Girici", logo: null });
    expect(parseBrand({ name: "X", logo: "https://evil.test/a.png" }).logo).toBeNull();
    expect(parseBrand({ name: "X", logo: "/_g/brand/logo?v=1" }).logo).toBe("/_g/brand/logo?v=1");
    const failing = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchBrand(failing)).toEqual({ name: "Girici", logo: null });
  });

  it("swaps the favicon for the logo and back", () => {
    const doc = fakeDocument();
    const original = [...doc.links];
    applyBrandToDocument({ name: "Kütüphane", logo: "/_g/brand/logo?v=1" }, doc);
    expect(doc.title).toBe("Kütüphane");
    expect(doc.links.map((link) => [link.rel, link.href])).toEqual([["icon", "/_g/brand/logo?v=1"]]);
    applyBrandToDocument({ name: "Kütüphane", logo: "/_g/brand/logo?v=2" }, doc);
    expect(doc.links.map((link) => link.href)).toEqual(["/_g/brand/logo?v=2"]);
    applyBrandToDocument({ name: "Girici", logo: null }, doc);
    expect(doc.title).toBe("Girici");
    expect(doc.links).toEqual(original);
  });
});

describe("brand editor", () => {
  it("refuses a logo the server would refuse", async () => {
    await expect(readLogoFile(new Blob([new Uint8Array(262_145)], { type: "image/png" }))).rejects.toThrow(LOGO_ERROR);
    await expect(readLogoFile(new Blob(["hi"], { type: "text/plain" }))).rejects.toThrow(LOGO_ERROR);
    const svg = "<svg/>";
    expect(await readLogoFile(new Blob([svg], { type: "image/svg+xml" }))).toEqual({
      type: "image/svg+xml",
      data: btoa(svg),
    });
  });

  it("explains a refused save", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ invalid: "name" }, { status: 400 }));
    await expect(saveBrand({ name: "x" }, "pw")).rejects.toThrow("The name can have up to 40 characters");
    vi.stubGlobal("fetch", async () => Response.json({ invalid: "logo" }, { status: 400 }));
    await expect(saveBrand({ logo: null }, "pw")).rejects.toThrow(LOGO_ERROR);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 413 }));
    await expect(saveBrand({ logo: null }, "pw")).rejects.toThrow(LOGO_ERROR);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
    await expect(saveBrand({ name: "x" }, "pw")).rejects.toThrow("The current password is wrong");
  });

  it("shows the saved brand", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ name: "Yeni", logo: "/_g/brand/logo?v=abc" }));
    expect(await saveBrand({ name: "Yeni" }, "pw")).toEqual({ name: "Yeni", logo: "/_g/brand/logo?v=abc" });
    expect(brand.value.name).toBe("Yeni");
  });
});
