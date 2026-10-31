import { describe, expect, it } from "vitest";
import { rewriteHtml } from "../src/rewrite/html.ts";

const TAG = '<script src="/_g/client.test.js"></script>';
const rw = (html: string, inject = false) =>
  rewriteHtml(html, {
    url: new URL("https://site.test/dir/page.html"),
    origin: "http://proxy.test",
    inject: inject ? TAG : undefined,
  });

describe("runtime injection", () => {
  it.each([
    [
      "<!doctype html><html><head><title>t</title></head></html>",
      `<!doctype html><html><head>${TAG}<title>t</title></head></html>`,
    ],
    [
      '<!DOCTYPE html>\n<!-- c -->\n<html lang="tr">\n<HEAD>\n<meta charset="utf-8">',
      `<!DOCTYPE html>\n<!-- c -->\n<html lang="tr">\n<HEAD>${TAG}\n<meta charset="utf-8">`,
    ],
    ["<!doctype html><script>a()</script><html><head>", `<!doctype html>${TAG}<script>a()</script><html><head>`],
    ["<html><body><p>x", `<html>${TAG}<body><p>x`],
    ["<!-- c --><!doctype html><p>x", `<!-- c --><!doctype html>${TAG}<p>x`],
    ["hi<head><title>t</title>", `${TAG}hi<head><title>t</title>`],
    ["plain text", `${TAG}plain text`],
  ])("injects into %j", (input, output) => {
    expect(rw(input, true)).toBe(output);
  });
});

describe("URL attributes", () => {
  it.each([
    ['<a href="https://other.test/x">', '<a href="/~/https/other.test/x">'],
    ["<a href=/x>", '<a href="/~/https/site.test/x">'],
    ['<a href="rel">', '<a href="rel">'],
    ['<a href="#h">', '<a href="#h">'],
    ['<a href="https://other.test/?a=1&amp;b=2">', '<a href="/~/https/other.test/?a=1&amp;b=2">'],
    ["<A HREF=https://x.test/ CLASS=x>", '<A href="/~/https/x.test/" CLASS=x>'],
    [
      '<img src="//cdn.test/a.png" srcset="https://cdn.test/a.png 1x, b.png 2x">',
      '<img src="/~/https/cdn.test/a.png" srcset="/~/https/cdn.test/a.png 1x, b.png 2x">',
    ],
    [
      '<form action="https://other.test/s"><button formaction="//cdn.test/p">',
      '<form action="/~/https/other.test/s"><button formaction="/~/https/cdn.test/p">',
    ],
    [
      '<video poster="https://x.test/p.jpg"><source src="https://x.test/v.mp4"><track src="/t.vtt">',
      '<video poster="/~/https/x.test/p.jpg"><source src="/~/https/x.test/v.mp4"><track src="/~/https/site.test/t.vtt">',
    ],
    [
      '<object data="https://x.test/a"></object><embed src="//x.test/b">',
      '<object data="/~/https/x.test/a"></object><embed src="/~/https/x.test/b">',
    ],
    ['<body background="https://x.test/bg.png">', '<body background="/~/https/x.test/bg.png">'],
    ['<svg><use xlink:href="https://x.test/s.svg#i"/></svg>', '<svg><use xlink:href="/~/https/x.test/s.svg#i"/></svg>'],
    [
      '<img data-src="https://x.test/a.png" src="data:image/gif;base64,R0">',
      '<img data-src="https://x.test/a.png" src="data:image/gif;base64,R0">',
    ],
    [
      "<a href=\"javascript:location='https://x.test/'\">",
      "<a href=\"javascript:__g$.J(&quot;location='https://x.test/'&quot;)\">",
    ],
  ])("rewrites %s", (input, output) => {
    expect(rw(input)).toBe(output);
  });

  it("resolves later URLs against the first <base href>", () => {
    expect(
      rw('<base href="https://cdn.test/assets/"><img src="/x.png"><a href="y"><base href="https://ignored.test/">'),
    ).toBe(
      '<base href="/~/https/cdn.test/assets/"><img src="/~/https/cdn.test/x.png"><a href="y"><base href="/~/https/ignored.test/">',
    );
  });

  it("drops attributes that would break or leak", () => {
    expect(rw('<script src="https://cdn.test/a.js" integrity="sha384-x" nonce="n"></script>')).toBe(
      '<script src="/~/https/cdn.test/a.js"></script>',
    );
    expect(rw('<a ping="https://t.test/p" href="/x">')).toBe('<a href="/~/https/site.test/x">');
    expect(rw('<html manifest="x.appcache">')).toBe("<html>");
    expect(rw('<iframe src="https://other.test/f" sandbox="allow-scripts" credentialless csp="x"></iframe>')).toBe(
      '<iframe src="/~/https/other.test/f" sandbox="allow-scripts allow-same-origin"></iframe>',
    );
    expect(rw("<iframe sandbox></iframe>")).toBe('<iframe sandbox="allow-same-origin"></iframe>');
  });

  it("handles <link> by rel", () => {
    expect(rw('<link rel="preconnect" href="https://cdn.test"><link rel=dns-prefetch href=//cdn.test><p>')).toBe("<p>");
    expect(rw('<link rel="stylesheet" href="https://cdn.test/a.css">')).toBe(
      '<link rel="stylesheet" href="/~/https/cdn.test/a.css">',
    );
    expect(rw('<link rel="alternate stylesheet" href="/b.css">')).toBe(
      '<link rel="alternate stylesheet" href="/~/https/site.test/b.css">',
    );
    expect(rw('<link rel="icon" href="/favicon.ico">')).toBe('<link rel="icon" href="/~/https/site.test/favicon.ico">');
    expect(rw('<link rel="canonical" href="https://site.test/x">')).toBe(
      '<link rel="canonical" href="https://site.test/x">',
    );
  });

  it("handles <meta http-equiv>", () => {
    expect(rw('<meta http-equiv="refresh" content="0; url=https://other.test/">')).toBe(
      '<meta http-equiv="refresh" content="0; url=/~/https/other.test/">',
    );
    expect(rw('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><p>')).toBe("<p>");
    expect(rw('<meta property="og:url" content="https://site.test/x">')).toBe(
      '<meta property="og:url" content="https://site.test/x">',
    );
  });
});

describe("inline code", () => {
  it("rewrites scripts by type", () => {
    expect(rw('<script>location.href="https://x.test/"</script>')).toBe(
      '<script>__g$.L(location).href="https://x.test/"</script>',
    );
    expect(rw('<script type="module">import "./a.js"; location.reload()</script>')).toBe(
      '<script type="module">import "./a.js"; __g$.L(location).reload()</script>',
    );
    expect(rw('<script type="application/json">{"location":1}</script>')).toBe(
      '<script type="application/json">{"location":1}</script>',
    );
    expect(rw('<script type="text/template"><a href="https://x.test/">location</a></script>')).toBe(
      '<script type="text/template"><a href="https://x.test/">location</a></script>',
    );
    expect(rw('<script type="speculationrules">{"prerender":[]}</script><p>')).toBe("<p>");
  });

  it("rewrites import maps", () => {
    const map =
      '{"imports":{"a":"https://cdn.test/a.js","b/":"/b/"},"scopes":{"https://cdn.test/":{"c":"https://cdn.test/c.js"}}}';
    expect(rw(`<script type="importmap">${map}</script>`)).toBe(
      '<script type="importmap">{"imports":{"a":"/~/https/cdn.test/a.js","b/":"/~/https/site.test/b/"},"scopes":{"/~/https/cdn.test/":{"c":"/~/https/cdn.test/c.js"}}}</script>',
    );
    expect(rw('<script type="importmap">{oops</script>')).toBe('<script type="importmap">{oops</script>');
  });

  it("rewrites styles and handlers", () => {
    expect(rw("<style>a{background:url(https://cdn.test/a.png)}</style>")).toBe(
      '<style>a{background:url("/~/https/cdn.test/a.png")}</style>',
    );
    expect(rw("<p style=\"background:url('/b.png')\">")).toBe(
      '<p style="background:url(&quot;/~/https/site.test/b.png&quot;)">',
    );
    expect(rw("<button onclick=\"location.href='/x'\">")).toBe("<button onclick=\"__g$.L(location).href='/x'\">");
  });

  it("rewrites srcdoc attributes without touching its scripts", () => {
    expect(
      rw('<iframe srcdoc="<a href=&quot;https://other.test/&quot;>x</a><script>location.href</script>"></iframe>'),
    ).toBe('<iframe srcdoc="<a href=&quot;/~/https/other.test/&quot;>x</a><script>location.href</script>"></iframe>');
  });
});

describe("documents that are not well formed", () => {
  it("leaves comments, raw text and split script strings alone", () => {
    const html =
      '<!-- <a href="https://x.test/"> --><title>a<b</title><textarea><a href="https://x.test/"></textarea><script>document.write("</scr"+"ipt>")</script>';
    expect(rw(html)).toBe(html);
  });

  it("survives URLs and bases that are not web URLs", () => {
    expect(rw('<a href="java&#10;script:void(0)">x</a>')).toBe(
      '<a href="javascript:__g$.J(&quot;void(0)&quot;)">x</a>',
    );
    expect(rw('<base href="ftp://x.test/"><a href="y">')).toBe('<base href="ftp://x.test/"><a href="y">');
  });

  it("rewrites unclosed and unquoted markup", () => {
    expect(rw("<div><a href=https://x.test/a>t<p><img src=/i.png alt=x>")).toBe(
      '<div><a href="/~/https/x.test/a">t<p><img src="/~/https/site.test/i.png" alt=x>',
    );
  });

  it("is idempotent without injection", () => {
    const once = rw(
      '<a href="https://x.test/"><img srcset="/a.png 1x"><script>location.href</script><style>a{b:url(/c.png)}</style>',
    );
    expect(rw(once)).toBe(once);
  });
});

describe("srcdoc documents", () => {
  const frameInject = (base: URL) => `<script src="http://p.test/_g/client.T.js" data-girici="${base.href}"></script>`;

  it("gives srcdoc documents the runtime with the frame's base", () => {
    const html = rewriteHtml(
      '<base href="https://cdn.a.test/d/"><iframe srcdoc="<script>go(location)</script>"></iframe>',
      { url: new URL("https://a.test/p"), origin: "http://p.test", frameInject },
    );
    expect(html).toContain(
      "&lt;script src=&quot;http://p.test/_g/client.T.js&quot; data-girici=&quot;https://cdn.a.test/d/&quot;",
    );
    expect(html).toContain("go(__g$.L(location))");
  });

  it("passes the runtime on to nested srcdoc documents", () => {
    const inner = '<iframe srcdoc="<p>x</p>"></iframe>';
    const html = rewriteHtml(`<iframe srcdoc="${inner.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`, {
      url: new URL("https://a.test/p"),
      origin: "http://p.test",
      frameInject,
    });
    expect(html.match(/client\.T\.js/g)).toHaveLength(2);
  });

  it("runtime-wraps srcdoc on iframes only", () => {
    const html = rewriteHtml('<div srcdoc="<script>go(location)</script>"></div>', {
      url: new URL("https://a.test/p"),
      origin: "http://p.test",
      frameInject,
    });
    expect(html).not.toContain("client.T.js");
    expect(html).not.toContain("__g$");
  });

  it("keeps a single runtime tag when the markup already starts with it", () => {
    const inject = frameInject(new URL("https://a.test/p"));
    const once = rewriteHtml("<p>x</p>", { url: new URL("https://a.test/p"), origin: "http://p.test", inject });
    const twice = rewriteHtml(once, { url: new URL("https://a.test/p"), origin: "http://p.test", inject });
    expect(twice).toBe(once);
  });

  it("leaves srcdoc scripts alone without frameInject", () => {
    const html = rewriteHtml('<iframe srcdoc="<script>go(location)</script>"></iframe>', {
      url: new URL("https://a.test/p"),
      origin: "http://p.test",
    });
    expect(html).not.toContain("__g$");
  });
});
