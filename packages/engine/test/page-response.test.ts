import { describe, expect, it } from "vitest";
import { STANDALONE_SHIM } from "../src/rewrite/js.ts";
import { SANDBOX_CSP } from "../src/sw/error-page.ts";
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
  it("refuses to serve a page when its runtime cannot be verified", async () => {
    const res = await buildPageResponse(
      upstream([["content-type", "text/html"]], "<p>x</p>"),
      context({ navigation: true, destination: "document", runtimeAvailable: async () => false }),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("could not verify its page script");
  });

  it("serves an untyped navigation inert", async () => {
    const res = await buildPageResponse(
      upstream([["content-security-policy", "default-src *"]], "<script>x()</script>"),
      context({ navigation: true, destination: "iframe" }),
    );
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves an untyped or invalid-typed navigation as plain text", async () => {
    for (const headers of [[], [["content-type", "foo"]], [["content-type", "text/"]]] as Array<
      Array<[string, string]>
    >) {
      const res = await buildPageResponse(upstream(headers), context({ navigation: true, destination: "document" }));
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    }
  });

  it("serves a comma-joined html type as rewritten html", async () => {
    const res = await buildPageResponse(
      upstream(
        [
          ["content-type", "video/mp4"],
          ["content-type", "text/html"],
        ],
        "<p>x</p>",
      ),
      context({ navigation: true, destination: "document" }),
    );
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("sends an exempt navigation with only the type that exempted it", async () => {
    const res = await buildPageResponse(
      upstream([["content-type", 'text/html; x="a, video/mp4; "']]),
      context({ navigation: true, destination: "document" }),
    );
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("sends a sandboxed navigation with the single parsed type", async () => {
    const res = await buildPageResponse(
      upstream([["content-type", "text/plain; charset=x, text/xml"]]),
      context({ navigation: true, destination: "document" }),
    );
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
  });

  it("leaves subresources and media without a sandbox", async () => {
    const image = await buildPageResponse(
      upstream([["content-type", "image/svg+xml"]]),
      context({ destination: "image" }),
    );
    expect(image.headers.get("content-security-policy")).toBeNull();
    const video = await buildPageResponse(
      upstream([["content-type", "video/mp4"]]),
      context({ navigation: true, destination: "document" }),
    );
    expect(video.headers.get("content-security-policy")).toBeNull();
  });

  it("injects an absolute runtime URL and the page's site", async () => {
    const res = await buildPageResponse(
      upstream([["content-type", "text/html"]], "<p>x</p>"),
      context({ navigation: true, destination: "document", target: new URL("https://www.site-a.test/p") }),
    );
    const html = await res.text();
    expect(html).toContain(`<script src="${origin}/_g/client.test.js"`);
    expect(html).toContain("&quot;site&quot;:&quot;https://site-a.test&quot;");
  });

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
    expect(nav.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(nav.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(await nav.text()).toContain("does not open local or private network addresses");
    expect((await buildPageResponse(blocked, context({ target: new URL("http://10.0.0.1/") }))).type).toBe("error");
  });

  it("redirects a navigation to login on an auth error and fails subresources", async () => {
    const unauth: TransportResult = { ok: false, code: "auth", status: 401 };
    const nav = await buildPageResponse(
      unauth,
      context({ target: new URL("https://site-a.test/dir/page"), navigation: true, destination: "document" }),
    );
    expect(nav.status).toBe(303);
    expect(nav.headers.get("location")).toBe(
      `${origin}/_g/login?next=${encodeURIComponent("https://site-a.test/dir/page")}`,
    );
    expect((await buildPageResponse(unauth, context())).type).toBe("error");
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
      '<!doctype html><head><script src="http://127.0.0.1:41000/_g/client.test.js" data-girici="{&quot;v&quot;:2,&quot;cookies&quot;:[],&quot;site&quot;:&quot;https://site-a.test&quot;}"></script><title>t</title><a href="/~/https/site-b.test/">b</a>',
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
