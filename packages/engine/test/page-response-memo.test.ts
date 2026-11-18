import { describe, expect, it, vi } from "vitest";
import * as css from "../src/rewrite/css.ts";
import { buildPageResponse } from "../src/sw/page-response.ts";
import type { TransportResult } from "../src/sw/transport.ts";

vi.mock("../src/rewrite/css.ts", async (original) => {
  const actual = await original<typeof import("../src/rewrite/css.ts")>();
  return { ...actual, rewriteCss: vi.fn(actual.rewriteCss) };
});

const stylesheet = (etag: string): TransportResult => ({
  ok: true,
  response: {
    status: 200,
    headers: [
      ["content-type", "text/css"],
      ["etag", etag],
    ],
    setCookies: [],
    body: new Response("a{background:url(/x.png)}").body,
  },
});

describe("buildPageResponse stylesheet memo", () => {
  it("rewrites a stylesheet once per validator", async () => {
    const ctx = {
      target: new URL("https://site-a.test/memo.css"),
      origin: "http://127.0.0.1:41000",
      destination: "style" as const,
      navigation: false,
      clientScript: "/_g/client.test.js",
      cookies: async () => [],
    };
    const first = await (await buildPageResponse(stylesheet('"1"'), ctx)).text();
    const again = await (await buildPageResponse(stylesheet('"1"'), ctx)).text();
    expect(again).toBe(first);
    expect(css.rewriteCss).toHaveBeenCalledTimes(1);
    await buildPageResponse(stylesheet('"2"'), ctx);
    expect(css.rewriteCss).toHaveBeenCalledTimes(2);
  });
});
