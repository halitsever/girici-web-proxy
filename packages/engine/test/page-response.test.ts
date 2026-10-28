import { describe, expect, it } from "vitest";
import { STANDALONE_SHIM } from "../src/rewrite/js.ts";
import { buildPageResponse, type PageContext } from "../src/sw/page-response.ts";
import type { TransportResult } from "../src/sw/transport.ts";

const origin = "http://127.0.0.1:41000";

function upstream(headers: Array<[string, string]>, body: BodyInit | null = "body", status = 200): TransportResult {
  return {
    ok: true,
    response: { status, headers, setCookies: [], body: body === null ? null : new Response(body).body },
  };
}

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    target: new URL("https://site-a.test/dir/page"),
    origin,
    destination: "",
    navigation: false,
    clientScript: "/_g/client.test.js",
    cookies: async () => [],
    ...overrides,
  };
}

describe("buildPageResponse", () => {
  it("rebuilds the upstream response from the envelope", async () => {
    const res = await buildPageResponse(
      upstream(
        [
          ["content-type", "text/plain"],
          ["content-encoding", "gzip"],
          ["content-length", "4"],
          ["x-custom", "1"],
        ],
        "body",
        404,
      ),
      context(),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("x-custom")).toBe("1");
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.text()).toBe("body");
  });

  it("keeps content-length on an identity (non-encoded, non-rewritten) response", async () => {
    const res = await buildPageResponse(
      upstream([
        ["content-type", "video/mp4"],
        ["content-length", "100"],
      ]),
      context({ destination: "video" }),
    );
    expect(res.headers.get("content-length")).toBe("100");
  });

  it("drops content-length when the body was decompressed", async () => {
    const res = await buildPageResponse(
      upstream([
        ["content-type", "video/mp4"],
        ["content-encoding", "gzip"],
        ["content-length", "100"],
      ]),
      context({ destination: "video" }),
    );
    expect(res.headers.has("content-length")).toBe(false);
  });

  it("drops content-length when the body is rewritten", async () => {
    const res = await buildPageResponse(
      upstream([
        ["content-type", "text/javascript"],
        ["content-length", "100"],
      ]),
      context({ destination: "script" }),
    );
    expect(res.headers.has("content-length")).toBe(false);
  });

  it("maps a same-host redirect into the proxy", async () => {
    const res = await buildPageResponse(
      upstream([["location", "/next?x=1"]], null, 302),
      context({ target: new URL("https://site-a.test/a/b"), navigation: true, destination: "document" }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${origin}/~/https/site-a.test/next?x=1`);
  });

  it("maps a cross-host redirect", async () => {
    const res = await buildPageResponse(
      upstream([["location", "https://www.site-a.test/"]], null, 301),
      context({ target: new URL("http://site-a.test/"), navigation: true, destination: "document" }),
    );
    expect(res.headers.get("location")).toBe(`${origin}/~/https/www.site-a.test/`);
  });

  it("keeps non-web redirects, null bodies and the status range", async () => {
    const mail = await buildPageResponse(
      upstream([["location", "mailto:a@b.c"]], null, 302),
      context({ navigation: true, destination: "document" }),
    );
    expect(mail.headers.get("location")).toBe("mailto:a@b.c");
    const empty = await buildPageResponse(upstream([["content-type", "text/html"]], null, 204), context());
    expect(empty.body).toBeNull();
    const odd = await buildPageResponse(upstream([], "body", 999), context());
    expect(odd.type).toBe("error");
  });

  it("shows an error page for navigations and fails subresources", async () => {
    const blocked: TransportResult = { ok: false, code: "ssrf_blocked", status: 403 };
    const nav = await buildPageResponse(
      blocked,
      context({ target: new URL("http://10.0.0.1/"), navigation: true, destination: "document" }),
    );
    expect(nav.status).toBe(403);
    expect(await nav.text()).toContain("does not open local or private network addresses");
    expect((await buildPageResponse(blocked, context({ target: new URL("http://10.0.0.1/") }))).type).toBe("error");
  });

  it("rewrites documents and injects the client runtime", async () => {
    const res = await buildPageResponse(
      upstream(
        [["content-type", "text/html"]],
        '<!doctype html><head><title>t</title><a href="https://site-b.test/">b</a>',
      ),
      context({ destination: "document", navigation: true }),
    );
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe(
      '<!doctype html><head><script src="/_g/client.test.js" data-girici="{&quot;v&quot;:1,&quot;cookies&quot;:[]}"></script><title>t</title><a href="/~/https/site-b.test/">b</a>',
    );
  });

  it("rewrites stylesheets and scripts by destination only", async () => {
    const css = await buildPageResponse(
      upstream([["content-type", "text/css"]], "a{background:url(/x.png)}"),
      context({ destination: "style" }),
    );
    expect(await css.text()).toBe('a{background:url("/~/https/site-a.test/x.png")}');
    const js = await buildPageResponse(
      upstream([["content-type", "application/javascript"]], "location.href"),
      context({ destination: "script" }),
    );
    expect(await js.text()).toBe(`${STANDALONE_SHIM}__g$.L(location).href\n//# sourceURL=https://site-a.test/dir/page`);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const data = await buildPageResponse(
      upstream([["content-type", "application/javascript"]], "location.href"),
      context(),
    );
    expect(await data.text()).toBe("location.href");
  });

  it("decodes the declared charset before rewriting", async () => {
    const bytes = new Uint8Array([0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65, 0x20, 0xf0, 0xfe, 0xfd]);
    const res = await buildPageResponse(
      upstream([["content-type", "text/html; charset=windows-1254"]], bytes),
      context({ destination: "document", navigation: true }),
    );
    expect(await res.text()).toContain("Türkçe ğşı");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("rewrites Refresh headers", async () => {
    const res = await buildPageResponse(
      upstream([
        ["content-type", "text/plain"],
        ["refresh", "0; url=https://site-b.test/x"],
      ]),
      context({ destination: "document", navigation: true }),
    );
    expect(res.headers.get("refresh")).toBe("0; url=/~/https/site-b.test/x");
  });
});
