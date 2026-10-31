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
});
