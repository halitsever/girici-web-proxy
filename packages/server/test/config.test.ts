import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCE_URL, loadConfig, trustProxyWarning } from "../src/config.ts";
import { defaultDataDir } from "../src/paths.ts";

describe("loadConfig", () => {
  it("uses defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: "0.0.0.0",
      logLevel: "info",
      sourceUrl: DEFAULT_SOURCE_URL,
      testUpstreams: new Map(),
      testCaPath: undefined,
      youtubePoToken: true,
      dataDir: defaultDataDir,
      trustProxy: false,
      sessionSecret: undefined,
      rateLimit: 3000,
      blockedHosts: [],
      upstreamProxy: undefined,
    });
  });

  it("reads the data dir, trust proxy, and session secret override", () => {
    expect(loadConfig({ GIRICI_DATA_DIR: "/srv/girici" }).dataDir).toBe("/srv/girici");
    expect(loadConfig({ GIRICI_TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ GIRICI_TRUST_PROXY: "2" }).trustProxy).toBe(2);
    expect(loadConfig({ GIRICI_TRUST_PROXY: "loopback" }).trustProxy).toBe("loopback");
    expect(loadConfig({ GIRICI_SESSION_SECRET: "  hex  " }).sessionSecret).toBe("hex");
  });

  it("reads digits as a hop count, so 1 trusts exactly one proxy", () => {
    expect(loadConfig({ GIRICI_TRUST_PROXY: "1" }).trustProxy).toBe(1);
    expect(loadConfig({ GIRICI_TRUST_PROXY: "0" }).trustProxy).toBe(0);
    expect(loadConfig({ GIRICI_TRUST_PROXY: "yes" }).trustProxy).toBe(true);
  });

  it("reads GIRICI_SETUP_TOKEN and rejects a short one without echoing it", () => {
    expect(loadConfig({ GIRICI_SETUP_TOKEN: " long-enough-code " }).setupToken).toBe("long-enough-code");
    expect(loadConfig({}).setupToken).toBeUndefined();
    expect(() => loadConfig({ GIRICI_SETUP_TOKEN: "short" })).toThrow(/GIRICI_SETUP_TOKEN must be at least 8/);
    expect(() => loadConfig({ GIRICI_SETUP_TOKEN: "short" })).not.toThrow(/short"/);
  });

  it("warns only when every forwarding hop is trusted", () => {
    expect(trustProxyWarning(true)).toContain("GIRICI_TRUST_PROXY");
    for (const value of [false, 0, 1, 2, "loopback"]) expect(trustProxyWarning(value)).toBeNull();
  });

  it("turns the YouTube poToken minter off with GIRICI_YT_POTOKEN", () => {
    expect(loadConfig({ GIRICI_YT_POTOKEN: "off" }).youtubePoToken).toBe(false);
    expect(loadConfig({ GIRICI_YT_POTOKEN: "1" }).youtubePoToken).toBe(true);
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

  it("reads GIRICI_RATE_LIMIT, defaulting to 3000 and allowing 0", () => {
    expect(loadConfig({}).rateLimit).toBe(3000);
    expect(loadConfig({ GIRICI_RATE_LIMIT: "0" }).rateLimit).toBe(0);
    expect(loadConfig({ GIRICI_RATE_LIMIT: "600" }).rateLimit).toBe(600);
    expect(() => loadConfig({ GIRICI_RATE_LIMIT: "fast" })).toThrow(/GIRICI_RATE_LIMIT/);
    expect(() => loadConfig({ GIRICI_RATE_LIMIT: "-1" })).toThrow(/GIRICI_RATE_LIMIT/);
  });

  it("reads GIRICI_BLOCKED_HOSTS and names invalid entries", () => {
    expect(loadConfig({ GIRICI_BLOCKED_HOSTS: "a.com, *.b.com" }).blockedHosts).toEqual(["a.com", "b.com"]);
    expect(() => loadConfig({ GIRICI_BLOCKED_HOSTS: "a.com under_score.com" })).toThrow(/under_score\.com/);
  });

  it("reads GIRICI_UPSTREAM_PROXY and ignores the generic proxy variables", () => {
    expect(loadConfig({ GIRICI_UPSTREAM_PROXY: "socks5://127.0.0.1:1080" }).upstreamProxy).toEqual({
      protocol: "socks5",
      host: "127.0.0.1",
      port: 1080,
    });
    expect(
      loadConfig({ HTTP_PROXY: "http://corp:3128", ALL_PROXY: "socks5://corp:1080" }).upstreamProxy,
    ).toBeUndefined();
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
