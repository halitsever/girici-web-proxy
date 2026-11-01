import { describe, expect, it } from "vitest";
import { encodeHeaderList, encodeHeaderValue } from "../src/shared/protocol.ts";
import { HttpRelayTransport } from "../src/sw/transport.ts";

const request = () => new Request("http://proxy.test/~/https/site-a.test/p");
const ctx = { target: new URL("https://site-a.test/p"), clientUrl: null, isNavigation: true, cookie: "a=1" };
const envelope = { "x-girici-status": "200", "x-girici-headers": encodeHeaderList([]) };

function returning(response: Response | Error, seen: Array<{ url: string; init: RequestInit }> = []) {
  return new HttpRelayTransport(async (url, init) => {
    seen.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("HttpRelayTransport", () => {
  it("sends the relay request with the jar's cookies", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    await returning(
      new Response("ok", { headers: { "x-girici-status": "200", "x-girici-headers": encodeHeaderList([]) } }),
      seen,
    ).send(request(), ctx);
    expect(seen[0]?.url).toBe("/_g/r/https/site-a.test/p");
    expect(new Headers(seen[0]?.init.headers).get("x-girici-cookie")).toBe(encodeHeaderValue("a=1"));
  });

  it("unpacks status, headers, cookies and body", async () => {
    const result = await returning(
      new Response("body", {
        headers: {
          "x-girici-status": "302",
          "x-girici-headers": encodeHeaderList([
            ["location", "/next"],
            ["x-a", "1"],
          ]),
          "x-girici-set-cookie": encodeHeaderList([["set-cookie", "s=1; Path=/"]]),
        },
      }),
    ).send(request(), ctx);
    if (!result.ok) throw new Error("expected a response");
    expect(result.response.status).toBe(302);
    expect(result.response.headers).toEqual([
      ["location", "/next"],
      ["x-a", "1"],
    ]);
    expect(result.response.setCookies).toEqual(["s=1; Path=/"]);
    expect(await new Response(result.response.body).text()).toBe("body");
  });

  it("aborts the relay fetch when the page cancels the body", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const upstream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new TextEncoder().encode("start")),
    });
    const result = await returning(new Response(upstream, { headers: envelope }), seen).send(request(), {
      ...ctx,
      isNavigation: false,
    });
    if (!result.ok || !result.response.body) throw new Error("expected a body");
    const signal = seen[0]?.init.signal;
    expect(signal?.aborted).toBe(false);
    await result.response.body.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it("hands a navigation the relay's own body", async () => {
    const relay = new Response("page", { headers: envelope });
    const result = await returning(relay).send(request(), ctx);
    if (!result.ok) throw new Error("expected a response");
    expect(result.response.body).toBe(relay.body);
  });

  it("aborts the relay fetch when the page aborts its request", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const page = new AbortController();
    await returning(new Response("ok", { headers: envelope }), seen).send(
      new Request("http://proxy.test/~/https/site-a.test/p", { signal: page.signal }),
      ctx,
    );
    page.abort();
    expect(seen[0]?.init.signal?.aborted).toBe(true);
  });

  it("reports relay errors, malformed envelopes and failed fetches", async () => {
    expect(
      await returning(new Response("", { status: 403, headers: { "x-girici-error": "ssrf_blocked" } })).send(
        request(),
        ctx,
      ),
    ).toEqual({ ok: false, code: "ssrf_blocked", status: 403 });
    expect(await returning(new Response("", { headers: { "x-girici-headers": "%%%" } })).send(request(), ctx)).toEqual({
      ok: false,
      code: "connect",
      status: 502,
    });
    expect(await returning(new TypeError("Failed to fetch")).send(request(), ctx)).toEqual({
      ok: false,
      code: "connect",
      status: 502,
    });
  });
});
