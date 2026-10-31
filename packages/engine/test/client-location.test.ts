import { describe, expect, it } from "vitest";
import { createFakeLocation, type LocationEnv } from "../src/client/location.ts";
import { DESCRIPTOR_ADDITIONS, withPrototypeAdditions } from "./replaced-builtins.ts";

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

  it("hands javascript: URLs to the target window's runtime", () => {
    const { location, calls } = setup();
    location.href = "javascript:'<p>x</p>'";
    location.replace("javascript:void 0");
    expect(calls).toEqual([
      `assign javascript:__g$.J("'<p>x</p>'","https://site.test")`,
      'replace javascript:__g$.J("void 0","https://site.test")',
    ]);
  });

  it("takes no env member and no descriptor field from the page's Object.prototype", () => {
    const additions = {
      ...DESCRIPTOR_ADDITIONS,
      owner: { value: () => "https://evil.test", writable: true },
    };
    const calls = withPrototypeAdditions(additions, () => {
      const { location, calls } = setup();
      location.href = "javascript:void 0";
      location.href = "https://b.test/";
      return calls;
    });
    expect(calls).toEqual(['assign javascript:__g$.J("void 0","https://site.test")', "assign /~/https/b.test/"]);
  });

  it("reads a URL object once, so a later conversion cannot turn it into javascript:", () => {
    const { location, calls } = setup();
    let reads = 0;
    location.assign({ toString: () => (reads++ === 0 ? "javascript:void 0" : "https://b.test/") } as never);
    location.assign({ toString: () => (reads++ === 1 ? "https://b.test/" : "javascript:alert(1)") } as never);
    expect(calls).toEqual(['assign javascript:__g$.J("void 0","https://site.test")', "assign /~/https/b.test/"]);
  });

  it("navigates its own window through the address it is given", () => {
    const calls: string[] = [];
    const location = createFakeLocation({
      real: () => new URL("https://site.test/p"),
      navigate: (url, mode) => calls.push(`${mode} ${url}`),
      reload: () => {},
      setHash: (hash) => calls.push(`hash ${hash}`),
      address: (url) => `S:${url.pathname}`,
    });
    location.assign("/other");
    location.pathname = "/path";
    location.hash = "x";
    location.href = "#y";
    expect(calls).toEqual(["assign S:/other", "assign S:/path", "hash #x", "hash #y"]);
  });
});
