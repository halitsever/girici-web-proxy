import { describe, expect, it } from "vitest";
import { errorPage, errorResponse, forbiddenResponse, SANDBOX_CSP } from "../src/sw/error-page.ts";

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
