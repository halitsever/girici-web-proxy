import { describe, expect, it } from "vitest";
import { encodeHeaderList } from "../src/shared/protocol.ts";
import { buildPageResponse } from "../src/sw/page-response.ts";

const origin = "http://127.0.0.1:41000";

function relay(headers: Record<string, string>, body: BodyInit | null = "body", status = 200): Response {
  return new Response(body, { status, headers });
}

describe("buildPageResponse", () => {
  it("rebuilds the upstream response from the envelope", async () => {
    const res = buildPageResponse(
      relay({
        "x-girici-status": "404",
        "x-girici-headers": encodeHeaderList([
          ["content-type", "text/html"],
          ["content-encoding", "gzip"],
          ["content-length", "4"],
          ["x-custom", "1"],
        ]),
      }),
      new URL("https://site-a.test/"),
      "subresource",
      origin,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("x-custom")).toBe("1");
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.text()).toBe("body");
  });

  it("maps a same-host redirect into the proxy", () => {
    const res = buildPageResponse(
      relay({ "x-girici-status": "302", "x-girici-headers": encodeHeaderList([["location", "/next?x=1"]]) }, null),
      new URL("https://site-a.test/a/b"),
      "navigation",
      origin,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${origin}/~/https/site-a.test/next?x=1`);
  });

  it("maps a cross-host redirect", () => {
    const res = buildPageResponse(
      relay(
        { "x-girici-status": "301", "x-girici-headers": encodeHeaderList([["location", "https://www.site-a.test/"]]) },
        null,
      ),
      new URL("http://site-a.test/"),
      "navigation",
      origin,
    );
    expect(res.headers.get("location")).toBe(`${origin}/~/https/www.site-a.test/`);
  });

  it("keeps non-web redirects, null bodies and the status range", () => {
    const mail = buildPageResponse(
      relay({ "x-girici-status": "302", "x-girici-headers": encodeHeaderList([["location", "mailto:a@b.c"]]) }, null),
      new URL("https://site-a.test/"),
      "navigation",
      origin,
    );
    expect(mail.headers.get("location")).toBe("mailto:a@b.c");
    const empty = buildPageResponse(
      relay({ "x-girici-status": "204", "x-girici-headers": encodeHeaderList([]) }, null),
      new URL("https://site-a.test/"),
      "subresource",
      origin,
    );
    expect(empty.body).toBeNull();
    const odd = buildPageResponse(
      relay({ "x-girici-status": "999", "x-girici-headers": encodeHeaderList([]) }),
      new URL("https://site-a.test/"),
      "subresource",
      origin,
    );
    expect(odd.type).toBe("error");
  });

  it("shows an error page for navigations and fails subresources", async () => {
    const blocked = () => relay({ "x-girici-error": "ssrf_blocked", "x-girici-status": "403" }, "ssrf_blocked", 403);
    const nav = buildPageResponse(blocked(), new URL("http://10.0.0.1/"), "navigation", origin);
    expect(nav.status).toBe(403);
    expect(await nav.text()).toContain("does not open local or private network addresses");
    expect(buildPageResponse(blocked(), new URL("http://10.0.0.1/"), "subresource", origin).type).toBe("error");
  });
});
