import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp, clientKey, compileTrust } from "../src/http/client-ip.ts";

const fakeReq = (remote: string, xff?: string) =>
  ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as IncomingMessage;

describe("clientIp", () => {
  it("trusts X-Forwarded-For only as far as the trust setting allows", () => {
    const req = fakeReq("10.0.0.2", "203.0.113.7, 198.51.100.9");
    expect(clientIp(req, compileTrust(false))).toBe("10.0.0.2");
    expect(clientIp(req, compileTrust(1))).toBe("198.51.100.9");
    expect(clientIp(req, compileTrust(true))).toBe("203.0.113.7");
    expect(clientIp(req, compileTrust("loopback, 10.0.0.0/8"))).toBe("198.51.100.9");
  });
});

describe("clientKey", () => {
  it("keys IPv6 clients by their /64 and unwraps IPv4-mapped addresses", () => {
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe(clientKey("2001:db8:1:2:bbbb::9"));
    expect(clientKey("2001:db8:1:3::1")).not.toBe(clientKey("2001:db8:1:2::1"));
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
  });
});
