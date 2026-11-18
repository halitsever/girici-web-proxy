import { describe, expect, it } from "vitest";
import { createHtmlRewriter, rewriteHtml, type HtmlRewriteOptions } from "../src/rewrite/html.ts";

const TAG = '<script src="/_g/client.test.js"></script>';
const options = (inject: boolean): HtmlRewriteOptions => ({
  url: new URL("https://site.test/dir/page.html"),
  origin: "http://proxy.test",
  inject: inject ? TAG : undefined,
  frameInject: () => TAG,
});

const DOCUMENTS = [
  '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>t</title><link rel="stylesheet" href="/a.css"></head><body><a href="b.html">b</a></body></html>',
  `<!doctype html><html><head>${TAG}<base href="/sub/"><script>fetch("x"); location.href = "/y";</script></head><body><img src="i.png" srcset="a.png 1x, b.png 2x"></body>`,
  '<html><head><meta http-equiv="Content-Security-Policy" content="default-src none"><link rel="preconnect" href="https://cdn.test"><script type="speculationrules">{"prerender":[]}</script><style>body{background:url(bg.png)}</style></head><p style="background:url(x.png)">&amp; &lt;tag&gt; caf&eacute;</p>',
  '<!-- <a href="/c"> --><p onclick="location.href=\'/z\'">x</p><iframe srcdoc="<a href=&quot;/s&quot;>s</a><script>top.x</script>"></iframe><form action="/f"><button formaction="/g">g</button></form>',
  'text first<script type="module">import x from "/m.js"; export default x;</script><script type="importmap">{"imports":{"a":"/a.js"}}</script><meta http-equiv="refresh" content="5;url=/next"><video poster="/p.jpg"><source src="/v.mp4"></video>',
  '<svg><use xlink:href="#a"/><rect fill="url(#g)"/></svg><table background="/t.png"><tr><td>1</td></tr></table><script>var s = "</scr" + "ipt>"; document.write("<a href=/w>");</script><textarea><a href="/not">raw</a></textarea>',
  '<!DOCTYPE html>\n<!-- c -->\n<html>\n<HEAD>\n<script integrity="sha-x" nonce="n" src="/s.js"></script>\n</HEAD>\n<body ping="/p">\n</body>',
];

function streamed(html: string, cuts: number[], inject: boolean): string {
  const rewriter = createHtmlRewriter(options(inject));
  let out = "";
  let at = 0;
  for (const cut of [...cuts, html.length]) {
    out += rewriter.write(html.slice(at, cut));
    at = cut;
  }
  return out + rewriter.end();
}

describe("streaming HTML rewrite", () => {
  it.each(DOCUMENTS.map((doc, index) => [index, doc]))(
    "matches the one-shot rewrite at every split of #%i",
    (_, doc) => {
      for (const inject of [false, true]) {
        const whole = rewriteHtml(doc, options(inject));
        for (let cut = 0; cut <= doc.length; cut++) expect(streamed(doc, [cut], inject)).toBe(whole);
      }
    },
  );

  it("matches the one-shot rewrite in many small pieces", () => {
    const doc = DOCUMENTS.join("\n");
    const whole = rewriteHtml(doc, options(true));
    for (const size of [1, 2, 3, 7, 16, 61]) {
      const cuts: number[] = [];
      for (let at = size; at < doc.length; at += size) cuts.push(at);
      expect(streamed(doc, cuts, true)).toBe(whole);
    }
  });

  it("hands out the head before the rest of the document arrives", () => {
    const rewriter = createHtmlRewriter(options(true));
    const first = rewriter.write(
      '<!doctype html><html><head><title>t</title></head><body><p><a href="/a">a</a></p><p>more',
    );
    expect(first).toContain(`<head>${TAG}<title>t</title>`);
    expect(first).toContain('href="/~/https/site.test/a"');
    expect(first + rewriter.write(" text</p>") + rewriter.end()).toBe(
      `<!doctype html><html><head>${TAG}<title>t</title></head><body><p><a href="/~/https/site.test/a">a</a></p><p>more text</p>`,
    );
  });

  it("holds back a script until it closes", () => {
    const rewriter = createHtmlRewriter(options(false));
    const first = rewriter.write('<p>x</p><script>location.href = "/a"');
    expect(first).toBe("<p>x</p><script>");
    expect(first + rewriter.write(";</script>") + rewriter.end()).toBe(
      rewriteHtml('<p>x</p><script>location.href = "/a";</script>', options(false)),
    );
  });
});
