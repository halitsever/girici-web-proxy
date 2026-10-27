import { describe, expect, it } from "vitest";
import { decodeUrl, encodeUrl, isReservedPath, relayPathFor, targetFromRelayPath } from "../src/shared/codec.ts";

describe("encodeUrl", () => {
  it("builds structured proxy paths", () => {
    expect(encodeUrl(new URL("https://Example.com/a/b?x=1#top"))).toBe("/~/https/example.com/a/b?x=1#top");
    expect(encodeUrl(new URL("http://example.com:8080"))).toBe("/~/http/example.com:8080/");
    expect(encodeUrl(new URL("https://example.com:443/"))).toBe("/~/https/example.com/");
    expect(encodeUrl(new URL("https://[2001:db8::1]/x"))).toBe("/~/https/[2001:db8::1]/x");
    expect(encodeUrl(new URL("https://bücher.de/"))).toBe("/~/https/xn--bcher-kva.de/");
  });

  it("rejects non-http schemes", () => {
    expect(() => encodeUrl(new URL("ftp://example.com/"))).toThrow(TypeError);
  });
});

describe("decodeUrl", () => {
  it("decodes what encodeUrl produces", () => {
    for (const href of [
      "https://example.com/a/b?x=1",
      "http://example.com:8080/",
      "https://[2001:db8::1]/x",
      "https://xn--bcher-kva.de/",
    ]) {
      expect(decodeUrl(encodeUrl(new URL(href)))?.href).toBe(href);
    }
  });

  it("adds the root path when only a host is given", () => {
    expect(decodeUrl("/~/https/example.com")?.href).toBe("https://example.com/");
  });

  it("keeps @ and percent sequences in the path", () => {
    expect(decodeUrl("/~/https/example.com/@user/100%25")?.href).toBe("https://example.com/@user/100%25");
  });

  it("rejects malformed proxy paths", () => {
    for (const path of [
      "/",
      "/~/",
      "/~/https/",
      "/~/https//x",
      "/~/ftp/example.com/",
      "/~/https/user:pass@example.com/",
      "/~/https/user@example.com/",
      "/other/https/example.com/",
    ]) {
      expect(decodeUrl(path)).toBeNull();
    }
  });
});

describe("relay paths", () => {
  it("drop the hash and round-trip", () => {
    expect(relayPathFor(new URL("https://example.com/a?b=1#frag"))).toBe("/_g/r/https/example.com/a?b=1");
    expect(targetFromRelayPath("/_g/r/https/example.com/a?b=1")?.href).toBe("https://example.com/a?b=1");
    expect(targetFromRelayPath("/~/https/example.com/")).toBeNull();
  });
});

describe("isReservedPath", () => {
  it("reserves the UI and engine paths only", () => {
    expect(["/", "/robots.txt", "/_g/sw.js", "/_g/r/https/x/"].map(isReservedPath)).toEqual([true, true, true, true]);
    expect(["/~/https/x/", "/favicon.ico", "/login", "/~"].map(isReservedPath)).toEqual([false, false, false, false]);
  });
});
