import { describe, expect, it } from "vitest";
import { STANDALONE_SHIM } from "../src/rewrite/js.ts";
import { MasterSealer } from "../src/shared/sealed-address.ts";
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

  it("rewrites an untyped navigation whose body starts as HTML", async () => {
    for (const body of ["<!DOCTYPE html><p>x</p>", "\uFEFF\n  <html><p>x</p></html>"]) {
      const res = await buildPageResponse(upstream([], body), context({ navigation: true, destination: "document" }));
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(await res.text()).toContain("/_g/client.test.js");
    }
  });

  it("keeps an untyped navigation that is not HTML as sandboxed text", async () => {
    const res = await buildPageResponse(
      upstream([["content-length", "15"]], "hello <html> x."),
      context({ navigation: true, destination: "document" }),
    );
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    expect(res.headers.get("content-length")).toBe("15");
    expect(await res.text()).toBe("hello <html> x.");
  });

  it("starts an untyped download before its last byte arrives", async () => {
    let more!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        more = controller;
        controller.enqueue(new Uint8Array(2000).fill(120));
      },
    });
    const result: TransportResult = { ok: true, response: { status: 200, headers: [], setCookies: [], body } };
    const res = await buildPageResponse(result, context({ navigation: true, destination: "document" }));
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
    more.enqueue(new Uint8Array([121]));
    more.close();
    const text = await res.text();
    expect(text.length).toBe(2001);
    expect(text.endsWith("xy")).toBe(true);
  });

  it("leaves an untyped subresource that looks like HTML untouched", async () => {
    const res = await buildPageResponse(upstream([], "<html><p>x</p>"), context({ destination: "" }));
    expect(await res.text()).toBe("<html><p>x</p>");
  });

  it("keeps the charset of a sandboxed text navigation", async () => {
    const res = await buildPageResponse(
      upstream([["content-type", "text/plain; charset=windows-1251; foo=bar"]]),
      context({ navigation: true, destination: "document" }),
    );
    expect(res.headers.get("content-type")).toBe("text/plain; charset=windows-1251");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX_CSP);
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

  it("sends a top-level load the server wants checked to the challenge page, and a frame to an inert page", async () => {
    const challenged: TransportResult = { ok: false, code: "challenge", status: 403 };
    const nav = await buildPageResponse(challenged, context({ navigation: true, destination: "document" }));
    expect(nav.status).toBe(303);
    expect(nav.headers.get("location")).toBe(
      `${origin}/_g/challenge?next=${encodeURIComponent("https://site-a.test/dir/page")}`,
    );
    const frame = await buildPageResponse(challenged, context({ navigation: true, destination: "iframe" }));
    expect(frame.status).toBe(403);
    expect(frame.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(await frame.text()).toContain("check this browser before it opens site-a.test");
    expect((await buildPageResponse(challenged, context())).type).toBe("error");
  });

  it("sends a sealed load to the challenge page with its sealed address", async () => {
    const nav = await buildPageResponse(
      { ok: false, code: "challenge", status: 403 },
      context({ navigation: true, destination: "document", address: () => "/~/x/L.B" }),
    );
    expect(new URL(nav.headers.get("location")!).searchParams.get("next")).toBe("/~/x/L.B");
  });

  it("shows the quota page with the server's wait", async () => {
    const nav = await buildPageResponse(
      { ok: false, code: "quota", status: 429, retryAfter: 120 },
      context({ navigation: true, destination: "document" }),
    );
    expect(nav.status).toBe(429);
    expect(nav.headers.get("retry-after")).toBe("120");
    expect(await nav.text()).toContain("Try again in 2 minutes.");
  });

  it("passes a rate limit's wait on to its page", async () => {
    const nav = await buildPageResponse(
      { ok: false, code: "rate_limited", status: 429, retryAfter: 30 },
      context({ navigation: true, destination: "document" }),
    );
    expect(nav.status).toBe(429);
    expect(nav.headers.get("retry-after")).toBe("30");
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
    expect(res.headers.get("refresh")).toBe("0; url=http://127.0.0.1:41000/~/https/site-b.test/x");
  });

  it("drops a Refresh header that would load a blob document, which no bootstrap can cover here", async () => {
    const res = await buildPageResponse(
      upstream([
        ["content-type", "text/plain"],
        ["refresh", "0; url=blob:http://proxy.test/1"],
      ]),
      context({ destination: "document", navigation: true }),
    );
    expect(res.headers.has("refresh")).toBe(false);
  });

  it("serves no markup that loads a blob document", async () => {
    const res = await buildPageResponse(
      upstream(
        [["content-type", "text/html"]],
        '<meta http-equiv="refresh" content="0;url=blob:http://proxy.test/1"><iframe src="blob:http://proxy.test/2"></iframe>' +
          '<object data=" BLOB:http://proxy.test/3"></object><embed src="blob:http://proxy.test/4"><frame src="blob:x">',
      ),
      context({ destination: "document", navigation: true }),
    );
    const text = await res.text();
    expect(text).not.toMatch(/blob:/i);
    expect(text).toContain('<iframe src="about:blank">');
    expect(text).toContain('<meta http-equiv="refresh" content="">');
  });
});

describe("pages on sealed addresses", () => {
  const master = new MasterSealer(new Uint8Array(32).fill(3));
  const target = new URL("https://a.test/dir/page");

  it("gives a sealed page its origin's seal and absolute relative URLs", async () => {
    const res = await buildPageResponse(
      upstream(
        [["content-type", "text/html"]],
        '<img src="a.png"><a href="#t">t</a><iframe srcdoc="<p>x</p>"></iframe>',
      ),
      context({ target, navigation: true, destination: "document", seal: master.originSeal("https://a.test") }),
    );
    const text = await res.text();
    expect(text).toContain("&quot;seal&quot;:{&quot;origin&quot;:&quot;https://a.test&quot;");
    expect(text).toContain('src="/~/https/a.test/dir/a.png"');
    expect(text).toContain('href="#t"');
    const srcdoc = /srcdoc="([^"]*)"/.exec(text)?.[1] ?? "";
    expect(srcdoc).toContain("data-girici");
    expect(srcdoc).not.toContain("seal");
  });

  it("seals the target of an upstream redirect for a top-level load", async () => {
    const res = await buildPageResponse(
      upstream([["location", "/next"]], null, 302),
      context({ target, navigation: true, destination: "document", address: (url) => master.seal(url) }),
    );
    expect(res.headers.get("location")).toBe(origin + master.seal(new URL("https://a.test/next")));
  });

  it("sends the sign-in page a sealed next", async () => {
    const res = await buildPageResponse(
      { ok: false, code: "auth", status: 401 },
      context({ target, navigation: true, destination: "document", address: (url) => master.seal(url) }),
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe(master.seal(target));
  });
});
