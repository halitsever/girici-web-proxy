import { describe, expect, it } from "vitest";
import { applyBrandToDocument, fetchBrand, parseBrand, type BrandDocument, type BrandElement } from "../brand";

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
