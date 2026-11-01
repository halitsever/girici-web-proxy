import { describe, expect, it } from "vitest";
import { resolveNext } from "../next";

describe("resolveNext", () => {
  it("opens Girici pages, proxy addresses and web URLs, and nothing else", () => {
    expect(resolveNext("/account")).toEqual({ kind: "route", path: "/account" });
    expect(resolveNext("/~/x/L.B")).toEqual({ kind: "proxy", path: "/~/x/L.B" });
    expect(resolveNext("/~/https/a.test/p?q=1")).toEqual({ kind: "proxy", path: "/~/https/a.test/p?q=1" });
    expect(resolveNext("https://a.test/")).toEqual({ kind: "proxy", path: "/~/https/a.test/" });
    for (const bad of ["//evil.test", "/\\evil.test", "javascript:x", "", "evil.test"]) {
      expect(resolveNext(bad), bad).toEqual({ kind: "home" });
    }
  });

  it("continues sign-in on a site host of this instance only", () => {
    const sealed = "https://k6wjalxihe6pja6woodbryo47k.proxy.test/~/x/abc.def";
    expect(resolveNext(sealed, "proxy.test")).toEqual({ kind: "site", url: sealed });
    const local = "http://cmkprjpf6pvd57ha4qtfwpo3wp.girici.localhost:41005/~/https/site-a.test/";
    expect(resolveNext(local, "girici.localhost:41005")).toEqual({ kind: "site", url: local });
    for (const bad of [
      "https://k6wjalxihe6pja6woodbryo47k.evil.test/~/x/abc.def",
      "https://www.proxy.test/~/https/a.test/",
      "https://proxy.test/settings",
      "https://k6wjalxihe6pja6woodbryo47k.proxy.test/settings",
      "//k6wjalxihe6pja6woodbryo47k.proxy.test/~/x/abc.def",
    ]) {
      expect(resolveNext(bad, "proxy.test"), bad).toEqual({ kind: "home" });
    }
    expect(resolveNext("https://a.test/", "proxy.test")).toEqual({ kind: "proxy", path: "/~/https/a.test/" });
    expect(resolveNext("/~/x/L.B", "proxy.test")).toEqual({ kind: "proxy", path: "/~/x/L.B" });
    expect(resolveNext("/account", "proxy.test")).toEqual({ kind: "route", path: "/account" });
  });

  it("reads a site host address as a web URL without a site domain, as before", () => {
    for (const domain of [undefined, null]) {
      expect(resolveNext("https://k6wjalxihe6pja6woodbryo47k.proxy.test/~/x/abc.def", domain)).toEqual({
        kind: "proxy",
        path: "/~/https/k6wjalxihe6pja6woodbryo47k.proxy.test/~/x/abc.def",
      });
    }
  });
});
