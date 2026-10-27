import { encodeHeaderList, encodeHeaderValue } from "@girici/engine/shared";
import { describe, expect, it } from "vitest";
import { RelayRequestError } from "../src/upstream/errors.ts";
import { buildUpstreamHeaders } from "../src/upstream/request-headers.ts";

describe("buildUpstreamHeaders", () => {
  it("keeps allowlisted browser headers and drops the rest", () => {
    expect(
      buildUpstreamHeaders({
        "user-agent": "UA",
        accept: "text/html",
        "accept-language": "tr",
        "accept-encoding": "gzip, br, zstd, sdch",
        range: "bytes=0-9",
        cookie: "girici-session=1",
        authorization: "Basic eA==",
        host: "proxy:3000",
        "x-forwarded-for": "1.2.3.4",
        connection: "keep-alive",
      }),
    ).toEqual({
      "user-agent": "UA",
      accept: "text/html",
      "accept-language": "tr",
      "accept-encoding": "gzip, br, zstd",
      range: "bytes=0-9",
    });
  });

  it("turns the jar's cookies into the upstream Cookie header and never forwards ours", () => {
    const headers = buildUpstreamHeaders({ "x-girici-cookie": encodeHeaderValue("a=1; b=2"), cookie: "girici=1" });
    expect(headers.cookie).toBe("a=1; b=2");
    expect(() => buildUpstreamHeaders({ "x-girici-cookie": encodeHeaderValue("a=1\r\nx: y") })).toThrow(
      RelayRequestError,
    );
  });

  it("applies the page's headers from the envelope, minus forbidden ones", () => {
    expect(
      buildUpstreamHeaders({
        accept: "*/*",
        "x-girici-headers": encodeHeaderList([
          ["x-requested-with", "XMLHttpRequest"],
          ["accept", "application/json"],
          ["cookie", "a=1"],
          ["host", "evil"],
          ["x-girici-relay", "1"],
          ["sec-fetch-site", "none"],
          ["origin", "https://evil"],
        ]),
      }),
    ).toEqual({ accept: "application/json", "x-requested-with": "XMLHttpRequest" });
  });

  it("sets origin, referer and sec-fetch headers from the envelope", () => {
    expect(
      buildUpstreamHeaders({
        "x-girici-origin": encodeHeaderValue("https://site-a.test"),
        "x-girici-referer": encodeHeaderValue("https://site-a.test/page"),
        "x-girici-fetch": encodeHeaderValue("document;navigate;same-origin;?1"),
      }),
    ).toEqual({
      origin: "https://site-a.test",
      referer: "https://site-a.test/page",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
    });
  });

  it("rejects an undecodable envelope and ignores malformed fetch metadata", () => {
    expect(() => buildUpstreamHeaders({ "x-girici-headers": "***" })).toThrow(RelayRequestError);
    expect(buildUpstreamHeaders({ "x-girici-fetch": encodeHeaderValue("doc ument;x") })).toEqual({});
  });
});
