import { describe, expect, it } from "vitest";
import { describeProxy, parseUpstreamProxy } from "../src/upstream/proxy-config.ts";

describe("parseUpstreamProxy", () => {
  it.each([
    ["http://proxy.local:3128", { protocol: "http", host: "proxy.local", port: 3128 }],
    ["https://proxy.local", { protocol: "https", host: "proxy.local", port: 443 }],
    ["socks5://127.0.0.1", { protocol: "socks5", host: "127.0.0.1", port: 1080 }],
    ["socks5h://[::1]:9050", { protocol: "socks5h", host: "::1", port: 9050 }],
    [
      "http://user:p%40ss@proxy.local:8080",
      { protocol: "http", host: "proxy.local", port: 8080, username: "user", password: "p@ss" },
    ],
  ])("parses %s", (raw, expected) => {
    expect(parseUpstreamProxy(raw)).toEqual(expected);
  });

  it("is off when unset or blank", () => {
    expect(parseUpstreamProxy(undefined)).toBeUndefined();
    expect(parseUpstreamProxy("  ")).toBeUndefined();
  });

  it.each(["ftp://proxy.local", "socks4://proxy.local", "proxy.local:8080", "http://", "http://proxy.local/path"])(
    "rejects %s",
    (raw) => {
      expect(() => parseUpstreamProxy(raw)).toThrow(/GIRICI_UPSTREAM_PROXY/);
    },
  );

  it("never echoes credentials, even from malformed values", () => {
    for (const raw of [
      "ftp://user:secret@proxy.local",
      "ftp://user:p@ss@proxy.local",
      "http://user:pa/ss@proxy.local:8080",
      "http://user:%E0%A4%A@proxy.local",
    ]) {
      let message = "";
      try {
        parseUpstreamProxy(raw);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/GIRICI_UPSTREAM_PROXY/);
      expect(message).not.toMatch(/secret|ss@|pa\/ss|%E0/);
    }
    expect(describeProxy(parseUpstreamProxy("socks5://user:secret@proxy.local:1080")!)).toBe(
      "socks5://proxy.local:1080",
    );
  });
});
