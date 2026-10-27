import { describe, expect, it } from "vitest";
import { mapVary, splitUpstreamHeaders } from "../src/upstream/response-headers.ts";

describe("splitUpstreamHeaders", () => {
  it("moves cookies to their own list and drops policy headers", () => {
    const split = splitUpstreamHeaders({
      "content-type": "text/html; charset=utf-8",
      "set-cookie": ["a=1; Path=/", "b=2"],
      "content-security-policy": "default-src 'self'",
      "x-frame-options": "DENY",
      "strict-transport-security": "max-age=1",
      "access-control-allow-origin": "*",
      "alt-svc": 'h3=":443"',
      link: "<https://cdn.example/x.css>; rel=preload",
      connection: "close",
      "transfer-encoding": "chunked",
      "x-custom": "1",
      location: "/next",
    });
    expect(split.setCookies).toEqual(["a=1; Path=/", "b=2"]);
    expect(split.envelope).toEqual([
      ["content-type", "text/html; charset=utf-8"],
      ["x-custom", "1"],
      ["location", "/next"],
    ]);
    expect(split.native).toEqual({ "content-type": "text/html; charset=utf-8" });
  });

  it("copies content, cache and range headers natively", () => {
    const split = splitUpstreamHeaders({
      "content-encoding": "gzip",
      "content-length": "10",
      "content-range": "bytes 0-9/20",
      "accept-ranges": "bytes",
      "cache-control": "max-age=60",
      etag: '"x"',
      "last-modified": "Tue, 27 Oct 2026 08:00:00 GMT",
      vary: "Accept-Encoding",
    });
    expect(split.native).toEqual({
      "content-encoding": "gzip",
      "content-length": "10",
      "content-range": "bytes 0-9/20",
      "accept-ranges": "bytes",
      "cache-control": "max-age=60",
      etag: '"x"',
      "last-modified": "Tue, 27 Oct 2026 08:00:00 GMT",
      vary: "x-girici-relay, accept-encoding",
    });
  });
});

describe("mapVary", () => {
  it("maps vary onto the headers the relay moved", () => {
    expect(mapVary("Accept-Encoding, Cookie, Origin, X-Custom")).toBe(
      "x-girici-relay, accept-encoding, x-girici-cookie, x-girici-origin, x-girici-headers",
    );
    expect(mapVary(undefined)).toBe("x-girici-relay");
    expect(mapVary("*")).toBe("*");
  });
});
