import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_URL, loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("uses defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: "0.0.0.0",
      logLevel: "info",
      sourceUrl: DEFAULT_SOURCE_URL,
      testUpstreams: new Map(),
      testCaPath: undefined,
    });
  });

  it("reads test upstreams only in test mode", () => {
    const env = { GIRICI_TEST_UPSTREAMS: '{"site-a.test":"127.0.0.1:41443"}', GIRICI_TEST_CA: "/tmp/ca.pem" };
    expect([...loadConfig({ ...env, NODE_ENV: "test" }).testUpstreams]).toEqual([
      ["site-a.test", { host: "127.0.0.1", port: 41443 }],
    ]);
    expect(loadConfig({ ...env, NODE_ENV: "test" }).testCaPath).toBe("/tmp/ca.pem");
    expect(loadConfig(env).testUpstreams.size).toBe(0);
    expect(loadConfig(env).testCaPath).toBeUndefined();
    expect(() => loadConfig({ NODE_ENV: "test", GIRICI_TEST_UPSTREAMS: "{oops" })).toThrow(/GIRICI_TEST_UPSTREAMS/);
  });

  it("reads PORT and accepts LISTENER_PORT as an alias", () => {
    expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
    expect(loadConfig({ LISTENER_PORT: "4000" }).port).toBe(4000);
    expect(loadConfig({ PORT: "8080", LISTENER_PORT: "4000" }).port).toBe(8080);
    expect(loadConfig({ PORT: "" }).port).toBe(3000);
  });

  it("rejects ports that are not integers between 1 and 65535", () => {
    for (const value of ["abc", "0", "65536", "80.5", "-1"]) {
      expect(() => loadConfig({ PORT: value })).toThrow(/PORT/);
    }
    expect(() => loadConfig({ LISTENER_PORT: "abc" })).toThrow(/LISTENER_PORT/);
  });

  it("reads HOST", () => {
    expect(loadConfig({ HOST: "127.0.0.1" }).host).toBe("127.0.0.1");
  });

  it("parses LOG_LEVEL case-insensitively and rejects unknown levels", () => {
    expect(loadConfig({ LOG_LEVEL: "DEBUG" }).logLevel).toBe("debug");
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("accepts only http(s) SOURCE_URL values", () => {
    expect(loadConfig({ SOURCE_URL: "https://example.com/fork" }).sourceUrl).toBe("https://example.com/fork");
    expect(() => loadConfig({ SOURCE_URL: "javascript:alert(1)" })).toThrow(/SOURCE_URL/);
    expect(() => loadConfig({ SOURCE_URL: "not a url" })).toThrow(/SOURCE_URL/);
  });
});
