import type { LookupOptions } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it } from "vitest";
import { createGuardedLookup, isPublicAddress, SsrfBlockedError, validateTarget } from "../src/upstream/ssrf.ts";

function callLookup(lookup: LookupFunction, hostname: string, options: LookupOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve(options.all ? address : [address, family]);
    });
  });
}

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "240.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2001:db8::1",
    "2001::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("validateTarget", () => {
  const policy = { allowedTestHosts: new Set(["site-a.test"]), selfHost: "proxy.example.org:3000" };

  it.each([
    "https://example.com/",
    "http://example.com:8080/",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/",
    "https://site-a.test/",
  ])("accepts %s", (href) => {
    expect(() => validateTarget(new URL(href), policy)).not.toThrow();
  });

  it.each([
    "http://localhost/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://nas.home.arpa/",
    "https://other.test/",
    "https://foo.example/",
    "https://x.invalid/",
    "https://intranet/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::1]/",
    "https://example.com:22/",
    "https://proxy.example.org/",
    "ftp://example.com/",
  ])("blocks %s", (href) => {
    expect(() => validateTarget(new URL(href), policy)).toThrow(SsrfBlockedError);
  });
});

describe("createGuardedLookup", () => {
  it("passes vetted public addresses through", async () => {
    const lookup = createGuardedLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
    expect(await callLookup(lookup, "example.com", { all: true })).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(await callLookup(lookup, "example.com", {})).toEqual(["93.184.216.34", 4]);
  });

  it("rejects the whole answer when any address is private", async () => {
    const lookup = createGuardedLookup(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(callLookup(lookup, "rebind.example.com", { all: true })).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
