import { describe, expect, it } from "vitest";
import { mapRefresh, parseRefresh, rewriteRefresh } from "../src/rewrite/refresh.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const base = new URL("https://site.test/dir/page.html");
const origin = "http://proxy.test";
const rewrite = (value: string) => rewriteRefresh(value, base, origin);

describe("parseRefresh", () => {
  it.each([
    ["5; url=https://x.test/a", { time: "5", url: "https://x.test/a" }],
    ["0 url=https://x.test/a", { time: "0", url: "https://x.test/a" }],
    ["0.5;url=a", { time: "0", url: "a" }],
    [".5;url=a", { time: "0", url: "a" }],
    ["  7 ,  URL = 'b' tail", { time: "7", url: "b" }],
    ['0;url="c', { time: "0", url: "c" }],
    ["0;uri=x", { time: "0", url: "uri=x" }],
    ["0; ur", { time: "0", url: "ur" }],
    ["0;url x", { time: "0", url: "url x" }],
    ["3", { time: "3", url: null }],
    ["3; ", { time: "3", url: null }],
  ])("reads %s as the browser does", (value, expected) => {
    expect(parseRefresh(value)).toEqual(expected);
  });

  it.each(["", "soon", "5x;url=a", "x;url=a", "-1;url=a"])("reads nothing from %j", (value) => {
    expect(parseRefresh(value)).toBeNull();
  });
});

describe("rewriteRefresh", () => {
  it("proxies web targets in every syntax the browser follows", () => {
    expect(rewrite("5; url=https://x.test/a")).toBe("5; url=/~/https/x.test/a");
    expect(rewrite("0;URL='/b'")).toBe("0; url=/~/https/site.test/b");
    expect(rewrite("0; url=page2")).toBe("0; url=page2");
    expect(rewrite("0 url=https://evil.test/")).toBe("0; url=/~/https/evil.test/");
    expect(rewrite(".5;url=https://evil.test/")).toBe("0; url=/~/https/evil.test/");
    expect(rewrite("0;url='https://evil.test/' x")).toBe("0; url=/~/https/evil.test/");
  });

  it("keeps a refresh of the page itself", () => {
    expect(rewrite("3")).toBe("3");
  });

  it.each([
    "soon",
    "0 url=blob:http://proxy.test/1",
    "0.5;url=blob:http://proxy.test/1",
    ".5;url=blob:http://proxy.test/1",
    "0;url='blob:http://proxy.test/1' x",
    "0;url=BLOB:http://proxy.test/1",
    "0;url=javascript:alert(1)",
    "0;url=data:text/html,x",
    "0;url=about:blank",
  ])("drops %j, which the proxy cannot follow", (value) => {
    expect(rewrite(value)).toBe("");
  });

  it("maps a stored target back in the same syntax it reads", () => {
    expect(mapRefresh("0 url=/~/https/x.test/", (url) => `[${url}]`)).toBe("0; url=[/~/https/x.test/]");
    expect(mapRefresh("3", (url) => `[${url}]`)).toBe("3");
  });
});

describe("rewriteRefresh with built-ins the page replaced", () => {
  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`keeps the target proxied when ${name} is replaced`, () => {
      const rewritten = withReplaced(target, key, replacement, () => rewrite("5; url=https://x.test/a"));
      expect(rewritten).toBe("5; url=/~/https/x.test/a");
    });
  }
});
