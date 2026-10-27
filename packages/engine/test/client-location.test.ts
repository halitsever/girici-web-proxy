import { describe, expect, it } from "vitest";
import { createFakeLocation, type LocationEnv } from "../src/client/location.ts";

function setup(href = "https://site.test/dir/page?x=1#h") {
  let current = new URL(href);
  const calls: string[] = [];
  const env: LocationEnv = {
    real: () => current,
    navigate: (url, mode) => calls.push(`${mode} ${url}`),
    reload: () => calls.push("reload"),
    setHash: (hash) => {
      current = new URL(current.href);
      current.hash = hash;
      calls.push(`hash ${hash}`);
    },
  };
  return { location: createFakeLocation(env), calls };
}

describe("createFakeLocation", () => {
  it("reports the real URL", () => {
    const { location } = setup();
    expect(location.href).toBe("https://site.test/dir/page?x=1#h");
    expect([location.origin, location.protocol, location.host, location.hostname, location.port]).toEqual([
      "https://site.test",
      "https:",
      "site.test",
      "site.test",
      "",
    ]);
    expect([location.pathname, location.search, location.hash]).toEqual(["/dir/page", "?x=1", "#h"]);
    expect(String(location)).toBe("https://site.test/dir/page?x=1#h");
    expect(Object.prototype.toString.call(location)).toBe("[object Location]");
  });

  it("navigates through the proxy", () => {
    const { location, calls } = setup();
    location.href = "https://other.test/a";
    location.assign("/b");
    location.replace("c");
    location.pathname = "/p";
    location.search = "q=2";
    location.host = "other.test:8443";
    location.protocol = "http:";
    expect(calls).toEqual([
      "assign /~/https/other.test/a",
      "assign /~/https/site.test/b",
      "replace /~/https/site.test/dir/c",
      "assign /~/https/site.test/p?x=1#h",
      "assign /~/https/site.test/dir/page?q=2#h",
      "assign /~/https/other.test:8443/dir/page?x=1#h",
      "assign /~/http/site.test/dir/page?x=1#h",
    ]);
  });

  it("changes only the fragment without navigating", () => {
    const { location, calls } = setup();
    location.hash = "top";
    location.href = "#bottom";
    location.href = "https://site.test/dir/page?x=1#again";
    expect(calls).toEqual(["hash #top", "hash #bottom", "hash #again"]);
  });

  it("hands other schemes and reloads to the browser", () => {
    const { location, calls } = setup();
    location.href = "mailto:a@b.test";
    location.reload();
    expect(calls).toEqual(["assign mailto:a@b.test", "reload"]);
  });

  it("rejects invalid URLs like the browser", () => {
    const { location } = setup();
    expect(() => {
      location.href = "http://[bad";
    }).toThrow();
  });
});
