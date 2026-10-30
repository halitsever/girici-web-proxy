import { describe, expect, it } from "vitest";
import { readConfig } from "../src/client/config.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";

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
