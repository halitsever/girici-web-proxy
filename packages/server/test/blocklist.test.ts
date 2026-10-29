import { describe, expect, it } from "vitest";
import { HostBlocklist, normalizeHostEntry, parseHostList } from "../src/upstream/blocklist.ts";

describe("normalizeHostEntry", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["https://www.example.com/path?q=1", "www.example.com"],
    ["*.example.com", "example.com"],
    [".example.com.", "example.com"],
    ["bücher.de", "xn--bcher-kva.de"],
    ["[2001:db8::1]", "2001:db8::1"],
    ["203.0.113.7", "203.0.113.7"],
  ])("normalizes %s to %s", (raw, expected) => {
    expect(normalizeHostEntry(raw)).toBe(expected);
  });

  it.each(["", "   ", "not a host", "http://", "a..b", "-bad.com", "under_score.com"])("rejects %j", (raw) => {
    expect(normalizeHostEntry(raw)).toBeNull();
  });
});

describe("HostBlocklist", () => {
  it("blocks a host and its subdomains in every spelling", () => {
    const list = new HostBlocklist(["example.com"], []);
    for (const host of ["example.com", "WWW.Example.com", "a.b.example.com", "example.com."]) {
      expect(list.isBlocked(host)).toBe(true);
    }
    for (const host of ["notexample.com", "example.co", "com"]) expect(list.isBlocked(host)).toBe(false);
  });

  it("matches IP entries exactly, including bracketed IPv6 hostnames", () => {
    const list = new HostBlocklist([], ["2001:db8::1", "203.0.113.7"]);
    expect(list.isBlocked(new URL("https://[2001:db8:0:0::1]/").hostname)).toBe(true);
    expect(list.isBlocked("203.0.113.7")).toBe(true);
    expect(list.isBlocked("203.0.113.70")).toBe(false);
  });

  it("matches an IP entry however the address is spelled, IPv4-mapped IPv6 included", () => {
    const list = new HostBlocklist(["93.184.216.34"], []);
    expect(list.isBlocked(new URL("http://[::ffff:93.184.216.34]/").hostname)).toBe(true);
    expect(normalizeHostEntry("[::ffff:93.184.216.34]")).toBe("93.184.216.34");
  });

  it("applies env and stored entries together and replaces stored ones on update", () => {
    const list = new HostBlocklist(["env.example"], ["old.example"]);
    list.update(["new.example"]);
    expect(list.isBlocked("env.example")).toBe(true);
    expect(list.isBlocked("old.example")).toBe(false);
    expect(list.isBlocked("new.example")).toBe(true);
    expect(list.env()).toEqual(["env.example"]);
    expect(list.stored()).toEqual(["new.example"]);
  });
});

describe("parseHostList", () => {
  it("parses lists split by commas, spaces and newlines, dropping duplicates", () => {
    expect(parseHostList("a.com, b.com\nA.com  c.com")).toEqual({ hosts: ["a.com", "b.com", "c.com"], invalid: [] });
    expect(parseHostList("a.com under_score.com").invalid).toEqual(["under_score.com"]);
  });
});
