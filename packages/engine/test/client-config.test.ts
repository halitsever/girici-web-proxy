import { describe, expect, it } from "vitest";
import { parseConfig, readConfig, readCookies } from "../src/client/config.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const cookie = {
  name: "a",
  value: "1",
  domain: "a.test",
  path: "/",
  hostOnly: true,
  secure: false,
  expires: null,
  creation: 5,
};

describe("readConfig", () => {
  it("keeps an inherited context and the site, and drops malformed ones", () => {
    const inherit = { origin: "http://proxy.test", base: "https://a.test/x" };
    expect(readConfig(JSON.stringify({ v: 2, cookies: [], site: "https://a.test", inherit }))).toEqual({
      v: 2,
      cookies: [],
      site: "https://a.test",
      inherit,
    });
    expect(readConfig(JSON.stringify({ v: 2, cookies: [], inherit: { origin: 1 } })).inherit).toBeUndefined();
    expect(readConfig("junk")).toEqual({ v: PROTOCOL_VERSION, cookies: [] });
  });
});

describe("parseConfig", () => {
  const raw = JSON.stringify({ v: 2, cookies: [cookie], cookiesBlocked: true });

  it("parses with the natives it took at load", () => {
    const forged = { v: 2, cookies: [], site: "https://evil.test" };
    const parsed = withReplaced(JSON, "parse", { value: () => forged }, () =>
      withReplaced(Array, "isArray", { value: () => false }, () => parseConfig(raw)),
    );
    expect(parsed).toEqual({ v: 2, cookies: [cookie], cookiesBlocked: true });
    expect(withReplaced(Array, "isArray", { value: () => true }, () => parseConfig('{"v":2,"cookies":"x"}'))).toBe(
      null,
    );
  });

  it("takes no field from what the page added to Object.prototype", () => {
    const added = {
      site: { value: "https://evil.test", writable: true },
      cookiesBlocked: { value: false, writable: true },
      inherit: { value: { origin: "http://proxy.test", base: "https://evil.test/" }, writable: true },
      blob: { value: "blob:x", writable: true },
    };
    const parsed = withPrototypeAdditions(added, () => {
      const config = parseConfig(
        JSON.stringify({ v: 2, cookies: [], inherit: { origin: "http://proxy.test", base: "https://a.test/" } }),
      );
      return config && { site: config.site, blocked: config.cookiesBlocked, blob: config.inherit?.blob, config };
    });
    expect(parsed).toMatchObject({ site: undefined, blocked: undefined, blob: undefined });
    expect(Object.getPrototypeOf(parsed?.config)).toBeNull();
    expect(Object.getPrototypeOf(parsed?.config.inherit)).toBeNull();
  });
});

describe("readCookies", () => {
  it("keeps well-formed snapshots as null-prototype copies and drops the rest", () => {
    const copied = readCookies([cookie, { ...cookie, expires: "soon" }, { name: "b" }, null, "x"]);
    expect(copied).toEqual([cookie]);
    expect(Object.getPrototypeOf(copied?.[0])).toBeNull();
    expect(readCookies("x")).toBeNull();
  });

  it("reads only the snapshot's own fields", () => {
    const partial: Partial<typeof cookie> = { ...cookie };
    delete partial.hostOnly;
    const copied = withPrototypeAdditions({ hostOnly: { value: false, writable: true } }, () => readCookies([partial]));
    expect(copied).toEqual([]);
  });
});
