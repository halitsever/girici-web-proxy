import { describe, expect, it } from "vitest";
import { errorPage } from "../src/sw/error-page.ts";

describe("errorPage", () => {
  it("explains a rate limit", () => {
    expect(errorPage("rate_limited", new URL("https://a.test/"))).toContain("Too many requests from your network");
  });

  it("names a blocked host", () => {
    expect(errorPage("blocked", new URL("https://bad.test/"))).toContain("bad.test is blocked on this Girici server.");
  });

  it("blames the upstream proxy", () => {
    expect(errorPage("proxy", new URL("https://a.test/"))).toContain("Girici's upstream proxy could not reach a.test.");
  });
});
