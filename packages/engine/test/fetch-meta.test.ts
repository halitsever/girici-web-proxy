import { describe, expect, it } from "vitest";
import { refererFor, secFetchSite } from "../src/sw/fetch-meta.ts";

describe("secFetchSite", () => {
  it.each([
    [null, "https://a.example.com/", "none"],
    ["https://a.example.com/x", "https://a.example.com/y", "same-origin"],
    ["https://a.example.com/", "https://b.example.com/", "same-site"],
    ["https://news.bbc.co.uk/", "https://www.bbc.co.uk/", "same-site"],
    ["https://a.co.uk/", "https://b.co.uk/", "cross-site"],
    ["http://a.example.com/", "https://a.example.com/", "cross-site"],
    ["https://example.com/", "https://other.org/", "cross-site"],
  ])("secFetchSite(%s, %s) is %s", (from, to, site) => {
    expect(secFetchSite(from ? new URL(from) : null, new URL(to))).toBe(site);
  });
});

describe("refererFor", () => {
  it("computes the Referer like browsers do", () => {
    const page = new URL("https://site-a.test/dir/page?q=1#frag");
    expect(refererFor(page, new URL("https://site-a.test/x"), "")).toBe("https://site-a.test/dir/page?q=1");
    expect(refererFor(page, new URL("https://other.org/"), "")).toBe("https://site-a.test/");
    expect(refererFor(page, new URL("http://other.org/"), "")).toBeNull();
    expect(refererFor(page, new URL("https://other.org/"), "no-referrer")).toBeNull();
    expect(refererFor(page, new URL("https://other.org/"), "unsafe-url")).toBe("https://site-a.test/dir/page?q=1");
    expect(refererFor(page, new URL("https://other.org/"), "origin")).toBe("https://site-a.test/");
    expect(refererFor(page, new URL("https://other.org/"), "same-origin")).toBeNull();
    expect(refererFor(null, new URL("https://other.org/"), "")).toBeNull();
  });
});
