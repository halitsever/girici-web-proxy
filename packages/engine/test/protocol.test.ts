import { describe, expect, it } from "vitest";
import { decodeHeaderList, decodeHeaderValue, encodeHeaderList, encodeHeaderValue } from "../src/shared/protocol.ts";

describe("header values", () => {
  it("round-trips non-ASCII", () => {
    const value = "çğış 🚀 é";
    expect(decodeHeaderValue(encodeHeaderValue(value))).toBe(value);
    expect(encodeHeaderValue(value)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("uses the URL-safe alphabet without padding", () => {
    expect(encodeHeaderValue("a?b")).toBe("YT9i");
    expect(encodeHeaderValue("~~~")).toBe("fn5-");
  });
});

describe("header lists", () => {
  it("round-trips header lists", () => {
    const pairs: Array<[string, string]> = [
      ["set-cookie", "a=1; Path=/"],
      ["x-name", "çğ"],
    ];
    expect(decodeHeaderList(encodeHeaderList(pairs))).toEqual(pairs);
  });

  it("rejects malformed lists", () => {
    expect(() => decodeHeaderList(encodeHeaderValue('{"a":1}'))).toThrow();
    expect(() => decodeHeaderList(encodeHeaderValue('[["a",1]]'))).toThrow();
    expect(() => decodeHeaderList("***")).toThrow();
  });
});
