import { describe, expect, it } from "vitest";
import { isPublicSuffix, labelSiteOf } from "../src/shared/label-site.ts";

describe("labelSiteOf", () => {
  it("labels by schemeful site, private suffixes included", () => {
    expect(labelSiteOf(new URL("https://www.site-a.test/x"))).toBe("https://site-a.test");
    expect(labelSiteOf(new URL("https://alice.github.io/"))).toBe("https://alice.github.io");
    expect(labelSiteOf(new URL("https://news.bbc.co.uk/"))).toBe("https://bbc.co.uk");
    expect(labelSiteOf(new URL("http://192.0.2.1:8080/"))).toBe("http://192.0.2.1");
    expect(labelSiteOf(new URL("https://[2001:db8::1]/"))).toBe("https://[2001:db8::1]");
    expect(labelSiteOf(new URL("https://example.com./"))).toBe("https://example.com");
    expect(isPublicSuffix("github.io")).toBe(true);
    expect(isPublicSuffix("girici.localhost")).toBe(false);
    expect(isPublicSuffix("proxy.example")).toBe(false);
  });

  it("keeps single-label hosts and ports out of the site", () => {
    expect(labelSiteOf(new URL("http://localhost:8080/a"))).toBe("http://localhost");
    expect(labelSiteOf(new URL("https://WWW.Site-A.test:8443/"))).toBe("https://site-a.test");
    expect(isPublicSuffix("co.uk")).toBe(true);
    expect(isPublicSuffix("example")).toBe(true);
  });
});
