import { parseScript } from "meriyah";
import { describe, expect, it } from "vitest";
import { MAX_REWRITE_LENGTH, rewriteJs, STANDALONE_SHIM } from "../src/rewrite/js.ts";

describe("rewriteJs", () => {
  it.each([
    ["location.href", "__g$.L(location).href"],
    ["var u = location;", "var u = __g$.L(location);"],
    ['location = "https://x.test/"', 'location = __g$.N(location, ("https://x.test/"))'],
    ["window.location.href = u", "__g$.L(window.location).href = u"],
    ["document.location = u", '__g$.S(document, "location", (u))'],
    ['w["location"] = u', '__g$.S(w, "location", (u))'],
    ['top["location"].replace(u)', '__g$.L(top["location"]).replace(u)'],
    ["const { location } = window;", "const { location } = __g$.D(window);"],
    ["({ location: loc } = self);", "({ location: loc } = __g$.D(self));"],
    ["o = { location }", "o = { location: __g$.L(location) }"],
    ["typeof location", "typeof __g$.L(location)"],
    ["`${location}`", "`${__g$.L(location)}`"],
    ["a?.location.href", "__g$.L(a?.location)?.href"],
    ["x.location.location", "__g$.L(__g$.L(x.location).location)"],
    ["document.location = location.href", '__g$.S(document, "location", (__g$.L(location).href))'],
    ["function f(location) { return location.host }", "function f(location) { return __g$.L(location).host }"],
  ])("rewrites %s", (input, output) => {
    expect(rewriteJs(input)).toBe(output);
  });

  it.each([
    "o = { location: 1 }",
    "class A { location() {} get location() { return 1 } }",
    "location: for (;;) break location;",
    "window.location += '#a'",
    "location += '#a'",
    'var s = "location";',
    "x = __g$.L(location).href",
  ])("leaves %s alone", (input) => {
    expect(rewriteJs(input)).toBe(input);
  });

  it("leaves module bindings alone", () => {
    const source = 'import { location } from "x"; export { location };';
    expect(rewriteJs(source, { kind: "module" })).toBe(source);
  });

  it("falls back to module parsing for classic scripts that use import", () => {
    expect(rewriteJs('import x from "y"; location.reload()')).toBe('import x from "y"; __g$.L(location).reload()');
  });

  it("parses handlers as function bodies", () => {
    expect(rewriteJs("return location.href", { kind: "handler" })).toBe("return __g$.L(location).href");
  });

  it("returns the source untouched when it cannot or need not rewrite", () => {
    const plain = "const a = 1;";
    expect(rewriteJs(plain)).toBe(plain);
    expect(rewriteJs("location.href = ")).toBe("location.href = ");
    const huge = "location.href;" + " ".repeat(MAX_REWRITE_LENGTH);
    expect(rewriteJs(huge)).toBe(huge);
  });

  it("is idempotent", () => {
    for (const source of [
      "location.href",
      "document.location = u",
      "const { location } = window;",
      "a?.location.href",
      'location = "x"',
    ]) {
      const once = rewriteJs(source);
      expect(rewriteJs(once)).toBe(once);
    }
  });

  it("handles a large minified bundle", () => {
    const chunk = "function a(b){return b.location.href+location.search}var c={location:1};c.location=location.hash;";
    const source = chunk.repeat(Math.ceil(1_000_000 / chunk.length));
    const started = performance.now();
    const output = rewriteJs(source);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(() => parseScript(output, { webcompat: true })).not.toThrow();
    expect(rewriteJs(output)).toBe(output);
    expect(output).toContain('__g$.S(c, "location", (__g$.L(location).hash))');
  });

  it("handles very long expression chains", () => {
    const chain = '"ab"+'.repeat(5000);
    expect(rewriteJs(`${chain}location.href`)).toBe(`${chain}__g$.L(location).href`);
  });

  it("can make its output run where no runtime was installed", () => {
    expect(rewriteJs("location.href", { standalone: true })).toBe(`${STANDALONE_SHIM}__g$.L(location).href`);
    expect(rewriteJs('"use strict";\nlocation.href', { standalone: true })).toBe(
      `"use strict";${STANDALONE_SHIM}\n__g$.L(location).href`,
    );
    expect(rewriteJs("const a = 1;", { standalone: true })).toBe("const a = 1;");
    expect(rewriteJs(rewriteJs("location.href", { standalone: true }), { standalone: true })).toBe(
      `${STANDALONE_SHIM}__g$.L(location).href`,
    );
  });
});
