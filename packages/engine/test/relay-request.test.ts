import { describe, expect, it } from "vitest";
import { decodeHeaderList, decodeHeaderValue } from "../src/shared/protocol.ts";
import { buildRelayRequest } from "../src/sw/relay-request.ts";

describe("buildRelayRequest", () => {
  it("builds a GET relay request with the page's headers in the envelope", async () => {
    const request = new Request("https://site-a.test/a?b=1", {
      headers: { accept: "text/css", "x-test": "1", "x-girici-headers": "forged" },
    });
    const { url, init } = await buildRelayRequest(request, {
      target: new URL("https://site-a.test/a?b=1"),
      clientUrl: new URL("https://site-a.test/page"),
      isNavigation: false,
    });
    const headers = new Headers(init.headers);
    expect(url).toBe("/_g/r/https/site-a.test/a?b=1");
    expect(init.method).toBe("GET");
    expect(headers.get("x-girici-relay")).toBe("1");
    expect(headers.get("accept")).toBe("text/css");
    expect(decodeHeaderList(headers.get("x-girici-headers") ?? "")).toEqual([["x-test", "1"]]);
    expect(decodeHeaderValue(headers.get("x-girici-fetch") ?? "")).toBe("empty;cors;same-origin;");
    expect(decodeHeaderValue(headers.get("x-girici-referer") ?? "")).toBe("https://site-a.test/page");
    expect(headers.has("x-girici-origin")).toBe(false);
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("same-origin");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("tunnels other methods through POST with the body and the page origin", async () => {
    const request = new Request("https://site-a.test/api", {
      method: "PUT",
      body: "data",
      headers: { "content-type": "text/plain" },
    });
    const { init } = await buildRelayRequest(request, {
      target: new URL("https://site-a.test/api"),
      clientUrl: new URL("https://site-a.test/page"),
      isNavigation: false,
    });
    const headers = new Headers(init.headers);
    expect(init.method).toBe("POST");
    expect(headers.get("x-girici-method")).toBe("PUT");
    expect(headers.get("content-type")).toBe("text/plain");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe("data");
    expect(decodeHeaderValue(headers.get("x-girici-origin") ?? "")).toBe("https://site-a.test");
  });

  it("marks navigations as user-initiated documents", async () => {
    const { init } = await buildRelayRequest(new Request("https://site-a.test/"), {
      target: new URL("https://site-a.test/"),
      clientUrl: null,
      isNavigation: true,
    });
    expect(decodeHeaderValue(new Headers(init.headers).get("x-girici-fetch") ?? "")).toBe("document;navigate;none;?1");
  });
});
