import { describe, expect, it } from "vitest";
import { errorPage, errorResponse, forbiddenResponse, SANDBOX_CSP, waitText } from "../src/sw/error-page.ts";

describe("errorPage", () => {
  it("explains a rate limit", () => {
    expect(errorPage("rate_limited", new URL("https://a.test/"))).toContain("Too many requests from your network");
  });

  it("names a blocked host", () => {
    expect(errorPage("blocked", new URL("https://bad.test/"))).toContain("bad.test is blocked on this Girici server.");
  });

  it("explains a runtime that failed verification", () => {
    expect(errorPage("runtime", null)).toContain("turn that off for /_g/.");
  });

  it("blames the upstream proxy", () => {
    expect(errorPage("proxy", new URL("https://a.test/"))).toContain("Girici's upstream proxy could not reach a.test.");
  });

  it("explains a sealed address this browser cannot open", () => {
    expect(errorPage("sealed", null)).toContain("sealed in another browser");
  });

  it("explains a spent data allowance with the wait", () => {
    expect(errorPage("quota", new URL("https://a.test/"), 120)).toContain(
      "used up its data allowance on this Girici server. Try again in 2 minutes.",
    );
    expect(errorPage("quota", null, 30)).toContain("Try again in a minute.");
    expect(errorPage("quota", null, 7200)).toContain("Try again in 2 hours.");
    expect(errorPage("quota", null)).toContain("Try again later.");
    expect(errorResponse("quota", 429, null, 90).headers.get("retry-after")).toBe("90");
    expect(errorPage("challenge", new URL("https://a.test/"))).toContain("check this browser before it opens a.test");
  });
});

describe("waitText", () => {
  it("rounds a wait to minutes below an hour and a half, and to hours beyond", () => {
    expect(waitText(undefined)).toBe("later");
    expect(waitText(1)).toBe("in a minute");
    expect(waitText(90)).toBe("in a minute");
    expect(waitText(91)).toBe("in 2 minutes");
    expect(waitText(89 * 60)).toBe("in 89 minutes");
    expect(waitText(90 * 60)).toBe("in 2 hours");
    expect(waitText(10 * 3600)).toBe("in 10 hours");
  });
});

describe("errorResponse", () => {
  it("serves the page without script or opener, so no proxied page can borrow its realm", async () => {
    const res = errorResponse("bad_request", 400, null);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(await res.text()).toContain("This address cannot be opened through Girici.");
  });
});

describe("forbiddenResponse", () => {
  it("answers refusals with an inert document", () => {
    const res = forbiddenResponse();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
