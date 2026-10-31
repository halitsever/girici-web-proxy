import { parseScript } from "meriyah";
import { describe, expect, it } from "vitest";
import { MAX_REWRITE_LENGTH, rewriteJs, STANDALONE_SHIM } from "../src/rewrite/js.ts";

describe("rewriteJs", () => {
  it.each([
    ["location.href", "__g$.L(location).href"],
    ["top.document", "__g$.W(top).document"],
    ["window.parent.postMessage(m, o)", "__g$.P(__g$.W(window.parent)).postMessage(m, o)"],
    ["typeof top", "typeof top"],
    ["o = { parent }", "o = { parent: __g$.W(parent) }"],
    ["const { opener } = window;", "const { opener } = __g$.D(window);"],
    ["rect.top + node.parent", "rect.top + node.parent"],
    ["frame.contentWindow.parent.x", "__g$.W(frame.contentWindow.parent).x"],
    ["window['top'].x", "__g$.W(window['top']).x"],
    ["let parent = a; parent = b;", "let parent = a; parent = b;"],
    ["self.frames[0]", "__g$.W(self.frames)[0]"],
    ["var u = location;", "var u = __g$.L(location);"],
    ['location = "https://x.test/"', 'location = __g$.N(location, ("https://x.test/"))'],
    ["window.location.href = u", "__g$.L(window.location).href = u"],
    ["document.location = u", '__g$.S(document, "location", (u))'],
    ['w["location"] = u', '__g$.S(w, "location", (u))'],
    ['top["location"].replace(u)', '__g$.L(__g$.W(top)["location"]).replace(u)'],
    ["const { location } = window;", "const { location } = __g$.D(window);"],
    ["({ location: loc } = self);", "({ location: loc } = __g$.D(self));"],
    ["o = { location }", "o = { location: __g$.L(location) }"],
    ["typeof location", "typeof __g$.L(location)"],
    ["`${location}`", "`${__g$.L(location)}`"],
    ["a?.location.href", "__g$.L(a?.location)?.href"],
    ["x.location.location", "__g$.L(__g$.L(x.location).location)"],
    ["document.location = location.href", '__g$.S(document, "location", (__g$.L(location).href))'],
    ["function f(location) { return location.host }", "function f(location) { return __g$.L(location).host }"],
    ["eval(code)", "eval(__g$.E(code))"],
    ["eval(a, b)", "eval(__g$.E(a), b)"],
    ["window.eval(code)", "window.eval(__g$.E(code))"],
    ["window['eval'](code)", "window['eval'](__g$.E(code))"],
    ["globalThis['eval'](code)", "globalThis['eval'](__g$.E(code))"],
    ["const e = eval; e(x)", "const e = __g$.ev; e(x)"],
    ["[eval][0](x)", "[__g$.ev][0](x)"],
    ["import(spec)", "import(__g$.I(spec))"],
    ["import(spec, { with: { type: 'json' } })", "import(__g$.I(spec), { with: { type: 'json' } })"],
    ['parent.postMessage(m, "*")', '__g$.P(__g$.W(parent)).postMessage(m, "*")'],
    ["a.b.postMessage(location.href, o, [p])", "__g$.P(a.b).postMessage(__g$.L(location).href, o, [p])"],
    ['w["postMessage"](m, o)', '__g$.P(w)["postMessage"](m, o)'],
    ["(a || b).postMessage(m)", "(__g$.P(a || b)).postMessage(m)"],
    ["(n.next = t, n = n.next, p).postMessage(m)", "(__g$.P((n.next = t, n = n.next, p))).postMessage(m)"],
    ["w?.postMessage(m)", "__g$.P(w)?.postMessage(m)"],
    ["w.postMessage?.(m)", "__g$.P(w).postMessage?.(m)"],
    ["a?.b.postMessage(m)", "__g$.P(a?.b)?.postMessage(m)"],
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
    "postMessage(m)",
    "w.postMessage.call(w, m)",
    "f = w.postMessage",
    "new w.postMessage(m)",
    "w[k](m)",
    "class A extends B { f() { super.postMessage(m) } }",
    "x = __g$.P(w).postMessage(m)",
  ])("leaves %s alone", (input) => {
    expect(rewriteJs(input)).toBe(input);
  });

  it("leaves eval calls and bare eval tokens apart", () => {
    expect(rewriteJs("eval()")).toBe("eval()");
    expect(rewriteJs("obj.eval(x)")).toBe("obj.eval(x)");
    expect(rewriteJs('var s = "eval";')).toBe('var s = "eval";');
  });

  it("rewrites import.meta.url reads as modules", () => {
    expect(rewriteJs("const u = import.meta.url;", { kind: "module" })).toBe("const u = __g$.M(import.meta.url);");
    expect(rewriteJs("import.meta.resolve('x')", { kind: "module" })).toBe("import.meta.resolve('x')");
  });

  it("skips sources without a trigger keyword", () => {
    expect(rewriteJs("const a = 1 + 2;")).toBe("const a = 1 + 2;");
  });

  it("standalone shim defines the phase 2 helpers", () => {
    expect(STANDALONE_SHIM).toContain("ev:");
    expect(STANDALONE_SHIM).toContain("E:");
    expect(STANDALONE_SHIM).toContain("I:");
    expect(STANDALONE_SHIM).toContain("H:");
    expect(STANDALONE_SHIM).toContain("M:");
    expect(STANDALONE_SHIM).toContain("W:function(v){return v}");
    expect(STANDALONE_SHIM).toContain("P:");
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
      "eval(code)",
      "import(spec)",
      "const e = eval; e(x)",
      "a?.b.postMessage(m)",
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
