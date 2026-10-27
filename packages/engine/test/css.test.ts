import { describe, expect, it } from "vitest";
import { rewriteCss } from "../src/rewrite/css.ts";

const rw = (css: string) => rewriteCss(css, new URL("https://site.test/css/main.css"), "http://proxy.test");

describe("rewriteCss", () => {
  it("rewrites url() in every quoting style", () => {
    expect(rw("a{background:url(https://cdn.test/a.png)}")).toBe('a{background:url("/~/https/cdn.test/a.png")}');
    expect(rw("a{background:url('//cdn.test/a.png')}")).toBe('a{background:url("/~/https/cdn.test/a.png")}');
    expect(rw('a{background:URL( "/img/a.png" )}')).toBe('a{background:url("/~/https/site.test/img/a.png")}');
    expect(rw("a{background:url(https://cdn.test/a\\)b.png)}")).toBe('a{background:url("/~/https/cdn.test/a)b.png")}');
  });

  it("keeps relative and non-web URLs as written", () => {
    for (const css of [
      "a{background:url(img/a.png)}",
      "a{background:url(data:image/png;base64,AA)}",
      "a{background:url()}",
    ]) {
      expect(rw(css)).toBe(css);
    }
  });

  it("rewrites @import and image-set() strings", () => {
    expect(rw('@import "https://cdn.test/x.css";')).toBe('@import "/~/https/cdn.test/x.css";');
    expect(rw("@IMPORT url(//cdn.test/x.css) screen;")).toBe('@IMPORT url("/~/https/cdn.test/x.css") screen;');
    expect(rw('a{background:image-set("https://cdn.test/a.png" 1x, url(b.png) 2x)}')).toBe(
      'a{background:image-set("/~/https/cdn.test/a.png" 1x, url(b.png) 2x)}',
    );
    expect(rw("a{background:-webkit-image-set('/a.png' 1x)}")).toBe(
      'a{background:-webkit-image-set("/~/https/site.test/a.png" 1x)}',
    );
  });

  it("ignores comments and unrelated strings", () => {
    const css = '/* url(https://x.test/a.png) */ a::before{content:"url(https://x.test/)"}';
    expect(rw(css)).toBe(css);
  });

  it("is idempotent", () => {
    const once = rw('@import "https://cdn.test/x.css"; a{background:url(/a.png)}');
    expect(rw(once)).toBe(once);
  });
});
