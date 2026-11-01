import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resubmitResponse } from "../src/sw/resubmit.ts";

const own = "https://own.proxy.test/~/https/site-b.test/pay";
const other = "https://other.proxy.test/~/https/site-b.test/pay";

function post(body: BodyInit, type?: string): Request {
  return new Request(own, { method: "POST", headers: type ? { "content-type": type } : {}, body });
}

describe("resubmitResponse", () => {
  it("rebuilds a url-encoded form for the other host", async () => {
    const request = post("a=1&b=%C3%BC&a=2", "application/x-www-form-urlencoded");
    const response = await resubmitResponse(request, other);
    const html = await response!.text();
    expect(html).toContain(`action="${other}"`);
    expect(html).toContain('method="post"');
    expect(html).toContain('accept-charset="utf-8"');
    expect(html).toContain('enctype="application/x-www-form-urlencoded"');
    expect(html.match(/<input type="hidden" name="a" value="[12]">/g)).toHaveLength(2);
    expect(html.indexOf('value="1"')).toBeLessThan(html.indexOf('value="2"'));
    expect(html).toContain('<input type="hidden" name="b" value="ü">');
    const csp = response!.headers.get("content-security-policy")!;
    expect(csp).toContain("form-action https://other.proxy.test");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/]+=*'/);
  });

  it("allows its own script by hash and nothing else", async () => {
    const response = await resubmitResponse(post("a=1", "application/x-www-form-urlencoded"), other);
    const html = await response!.text();
    const script = /<script>([^<]*)<\/script>/.exec(html)![1]!;
    const hash = createHash("sha256").update(script).digest("base64");
    expect(response!.headers.get("content-security-policy")).toBe(
      `default-src 'none'; script-src 'sha256-${hash}'; form-action https://other.proxy.test; base-uri 'none'; ` +
        "frame-ancestors 'self' *.proxy.test",
    );
    expect(html).toContain("<noscript>");
    expect(response!.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response!.headers.get("origin-agent-cluster")).toBe("?1");
    expect(response!.headers.get("referrer-policy")).toBe("strict-origin");
  });

  it("lets every site host of a domain with a port frame it", async () => {
    const location = "http://k6wjalxihe6pja6woodbryo47k.girici.localhost:41005/~/https/site-a.test/";
    const response = await resubmitResponse(post("a=1", "application/x-www-form-urlencoded"), location);
    const csp = response!.headers.get("content-security-policy")!;
    expect(csp).toContain("form-action http://k6wjalxihe6pja6woodbryo47k.girici.localhost:41005;");
    expect(csp).toContain("frame-ancestors 'self' *.girici.localhost:41005");
  });

  it("escapes names and values", async () => {
    const body = new URLSearchParams([['x"><script>', '"><script>']]).toString();
    const html = await (await resubmitResponse(post(body, "application/x-www-form-urlencoded"), other))!.text();
    expect(html).toContain('name="x&quot;&gt;&lt;script&gt;" value="&quot;&gt;&lt;script&gt;"');
    expect(html.match(/<script>/g)).toHaveLength(1);
  });

  it("escapes the action", async () => {
    const html = await (await resubmitResponse(post("", "application/x-www-form-urlencoded"), `${other}?a="b`))!.text();
    expect(html).toContain('action="https://other.proxy.test/~/https/site-b.test/pay?a=&quot;b"');
  });

  it("keeps text/plain bodies", async () => {
    const response = await resubmitResponse(post("a=1\r\nb=x=y\r\nc=two\r\nlines\r\n", "text/plain"), other);
    const html = await response!.text();
    expect(html).toContain('enctype="text/plain"');
    expect(html).toContain('<input type="hidden" name="a" value="1">');
    expect(html).toContain('<input type="hidden" name="b" value="x=y">');
    expect(html).toContain('<input type="hidden" name="c" value="two\r\nlines">');
  });

  it("keeps multipart fields without files", async () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("b", "ü");
    const html = await (await resubmitResponse(post(form), other))!.text();
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('<input type="hidden" name="a" value="1">');
    expect(html).toContain('<input type="hidden" name="b" value="ü">');
  });

  it("leaves file uploads to a redirect", async () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("f", new File(["data"], "f.txt"));
    expect(await resubmitResponse(post(form), other)).toBeNull();
  });

  it("leaves other bodies to a redirect", async () => {
    expect(await resubmitResponse(post('{"a":1}', "application/json"), other)).toBeNull();
    expect(await resubmitResponse(post(new TextEncoder().encode("a=1")), other)).toBeNull();
  });
});
