import { describe, expect, it } from "vitest";
import { allowsCredentials, sameSiteContext } from "../src/sw/cookies/policy.ts";
import { CROSS_SITE } from "../src/sw/initiator.ts";

const u = (href: string) => new URL(href);

describe("sameSiteContext", () => {
  it("treats user navigations and same-site requests as strict", () => {
    expect(sameSiteContext(null, u("https://a.test/"), { topLevel: true, method: "GET" })).toBe("strict");
    expect(
      sameSiteContext(u("https://www.a.test/"), u("https://cdn.a.test/x"), { topLevel: false, method: "GET" }),
    ).toBe("strict");
  });

  it("allows lax cookies only on top-level cross-site GET navigations", () => {
    expect(sameSiteContext(u("https://b.test/"), u("https://a.test/"), { topLevel: true, method: "GET" })).toBe("lax");
    expect(sameSiteContext(u("https://b.test/"), u("https://a.test/"), { topLevel: true, method: "POST" })).toBe(
      "none",
    );
    expect(sameSiteContext(u("https://b.test/"), u("https://a.test/"), { topLevel: false, method: "GET" })).toBe(
      "none",
    );
  });

  it("compares sites by scheme too", () => {
    expect(sameSiteContext(u("http://a.test/"), u("https://a.test/"), { topLevel: false, method: "GET" })).toBe("none");
  });

  it("gives a cross-site navigation lax cookies at top level and none in frames", () => {
    const target = u("https://a.test/");
    expect(sameSiteContext(CROSS_SITE, target, { topLevel: true, method: "GET" })).toBe("lax");
    expect(sameSiteContext(CROSS_SITE, target, { topLevel: false, method: "GET" })).toBe("none");
    expect(sameSiteContext(CROSS_SITE, target, { topLevel: true, method: "POST" })).toBe("none");
  });
});

describe("allowsCredentials", () => {
  it("follows the request's credentials mode with real origins", () => {
    expect(allowsCredentials("include", u("https://b.test/"), u("https://a.test/"))).toBe(true);
    expect(allowsCredentials("same-origin", u("https://a.test/p"), u("https://a.test/q"))).toBe(true);
    expect(allowsCredentials("same-origin", u("https://b.test/"), u("https://a.test/"))).toBe(false);
    expect(allowsCredentials("same-origin", null, u("https://a.test/"))).toBe(true);
    expect(allowsCredentials("omit", null, u("https://a.test/"))).toBe(false);
  });
});
