import { describe, expect, it } from "vitest";
import { resolveInput, toProxyPath } from "../src/shared/target.ts";

describe("toProxyPath", () => {
  it("builds the proxy path for http(s) URLs", () => {
    expect(toProxyPath("https://example.com")).toBe("/~/https/example.com/");
    expect(toProxyPath("HTTP://Example.COM:8080/Path/To?q=1#top")).toBe("/~/http/example.com:8080/Path/To?q=1#top");
    expect(toProxyPath("https://example.com:443/")).toBe("/~/https/example.com/");
    expect(toProxyPath("https://[2001:db8::1]/x")).toBe("/~/https/[2001:db8::1]/x");
    expect(toProxyPath("https://bücher.de/")).toBe("/~/https/xn--bcher-kva.de/");
  });

  it("adds https:// when the scheme is missing and trims spaces", () => {
    expect(toProxyPath("  Wikipedia.org  ")).toBe("/~/https/wikipedia.org/");
  });

  it("rejects input that is not a public http(s) URL", () => {
    for (const input of [
      "",
      "   ",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/",
      "https://user:pass@example.com/",
      "localhost",
      "not a url",
    ]) {
      expect(toProxyPath(input)).toBeNull();
    }
  });
});

describe("resolveInput", () => {
  it("opens URLs and searches everything else", () => {
    expect(resolveInput("example.com")).toBe("/~/https/example.com/");
    expect(resolveInput("not a url")).toBe("/~/https/html.duckduckgo.com/html/?q=not%20a%20url");
    expect(resolveInput("localhost")).toBe("/~/https/html.duckduckgo.com/html/?q=localhost");
  });

  it("refuses empty input and broken URLs", () => {
    for (const input of ["", "   ", "https://user:pass@example.com/", "ftp://example.com/"]) {
      expect(resolveInput(input)).toBeNull();
    }
  });
});
