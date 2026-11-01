import { describe, expect, it } from "vitest";
import {
  COOKIE_MESSAGE,
  COOKIE_RPC_PATH,
  decodeHeaderList,
  decodeHeaderValue,
  encodeHeaderList,
  encodeHeaderValue,
  HEADER,
  PROTOCOL_VERSION,
  SHARED_WORKER_PATH,
} from "../src/shared/protocol.ts";
import { isReservedPath } from "../src/shared/codec.ts";

describe("cookie protocol", () => {
  it("names the cookie protocol", () => {
    expect([HEADER.cookie, HEADER.cookieSeq, HEADER.cookieSync]).toEqual([
      "x-girici-cookie",
      "x-girici-cseq",
      "x-girici-cookie-sync",
    ]);
    expect([PROTOCOL_VERSION, COOKIE_RPC_PATH, COOKIE_MESSAGE]).toEqual([2, "/_g/rpc/cookie", "girici:cookies"]);
  });
});

describe("worker protocol", () => {
  it("keeps the shared worker address among the worker's own RPC paths", () => {
    expect(SHARED_WORKER_PATH).toBe("/_g/rpc/shared-worker");
    expect(isReservedPath(SHARED_WORKER_PATH)).toBe(true);
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
