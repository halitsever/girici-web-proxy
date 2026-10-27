import { describe, expect, it } from "vitest";
import {
  BROADCAST_CHANNEL,
  COOKIE_RPC_PATH,
  decodeHeaderList,
  decodeHeaderValue,
  encodeHeaderList,
  encodeHeaderValue,
  HEADER,
  PROTOCOL_VERSION,
} from "../src/shared/protocol.ts";

describe("cookie protocol", () => {
  it("names the cookie protocol", () => {
    expect([HEADER.cookie, HEADER.cookieSeq, HEADER.cookieSync]).toEqual([
      "x-girici-cookie",
      "x-girici-cseq",
      "x-girici-cookie-sync",
    ]);
    expect([PROTOCOL_VERSION, COOKIE_RPC_PATH, BROADCAST_CHANNEL]).toEqual([1, "/_g/rpc/cookie", "__girici"]);
  });
});

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
