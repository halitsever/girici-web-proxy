import { describe, expect, it } from "vitest";
import { attributeKind, restoreAttribute, rewriteAttribute } from "../src/client/attribute-values.ts";
import { installAttributes } from "../src/client/attributes.ts";
import { createRewriteBridge } from "../src/client/rewrite-bridge.ts";
import type { Realm } from "../src/client/url-context.ts";
import { withReplaced } from "./replaced-builtins.ts";

const base = new URL("https://site.test/dir/page.html");
const origin = "http://proxy.test";

describe("rewriteAttribute", () => {
  it("rewrites URL and srcset attributes only", () => {
    expect(rewriteAttribute("a", "href", "https://other.test/x", base, origin)).toBe("/~/https/other.test/x");
    expect(rewriteAttribute("img", "srcset", "https://c.test/a.png 1x", base, origin)).toBe("/~/https/c.test/a.png 1x");
    expect(rewriteAttribute("object", "data", "//x.test/a", base, origin)).toBe("/~/https/x.test/a");
    expect(rewriteAttribute("div", "data", "//x.test/a", base, origin)).toBe("//x.test/a");
    expect(rewriteAttribute("a", "title", "https://other.test/x", base, origin)).toBe("https://other.test/x");
  });

  it("empties integrity on scripts and links, whose rewritten bodies no longer match the hash", () => {
    expect(rewriteAttribute("script", "integrity", "sha384-abc", base, origin)).toBe("");
    expect(rewriteAttribute("LINK", "Integrity", "sha384-abc", base, origin)).toBe("");
    expect(rewriteAttribute("div", "integrity", "sha384-abc", base, origin)).toBe("sha384-abc");
    expect(restoreAttribute("script", "integrity", "", base, origin)).toBe("");
  });
});

describe("restoreAttribute", () => {
  it("shows real URLs for values the proxy rewrote", () => {
    expect(restoreAttribute("a", "href", "/~/https/other.test/x", base, origin)).toBe("https://other.test/x");
    expect(restoreAttribute("a", "href", "http://proxy.test/~/https/other.test/y", base, origin)).toBe(
      "https://other.test/y",
    );
    expect(restoreAttribute("img", "srcset", "/~/https/c.test/a.png 1x, b.png 2x", base, origin)).toBe(
      "https://c.test/a.png 1x, b.png 2x",
    );
    expect(restoreAttribute("a", "href", "rel/x", base, origin)).toBe("rel/x");
  });
});

describe("srcdoc", () => {
  it("hands srcdoc to the HTML rewriter", () => {
    expect(attributeKind("IFRAME", "srcdoc")).toBe("html");
    expect(rewriteAttribute("iframe", "srcdoc", "<p>", base, origin, (m) => `[${m}]`)).toBe("[<p>]");
    expect(rewriteAttribute("iframe", "srcdoc", "<p>", base, origin)).toBe("<p>");
    expect(restoreAttribute("iframe", "srcdoc", "[<p>]", base, origin, (m) => m.slice(1, -1))).toBe("<p>");
  });
});

describe("srcdoc through the DOM hooks", () => {
  function fakeDom() {
    class FakeAttr {
      owner: FakeElement | null = null;
      attrName: string;
      raw: string;
      constructor(name: string, raw = "") {
        this.attrName = name;
        this.raw = raw;
      }
      // Accessors on the prototype, as in the DOM.
      get ownerElement(): FakeElement | null {
        return this.owner;
      }
      set ownerElement(value: FakeElement | null) {
        this.owner = value;
      }
      get name(): string {
        return this.attrName;
      }
      namespaceURI: string | null = null;
      get value(): string {
        return this.raw;
      }
      set value(value: string) {
        this.raw = value;
      }
      get nodeValue(): string {
        return this.raw;
      }
      set nodeValue(value: string) {
        this.raw = value;
      }
      get textContent(): string {
        return this.raw;
      }
      set textContent(value: string) {
        this.raw = value;
      }
      cloneNode(): FakeAttr {
        return new FakeAttr(this.name, this.raw);
      }
    }
    class FakeElement {
      // An accessor on the prototype, as in the DOM.
      get localName() {
        return "iframe";
      }
      map = new Map<string, FakeAttr>();
      put(name: string, value: string): void {
        const node = new FakeAttr(name, value);
        node.ownerElement = this;
        this.map.set(name, node);
      }
      setAttribute(name: string, value: string): void {
        this.put(name, value);
      }
      getAttribute(name: string): string | null {
        return this.map.get(name)?.raw ?? null;
      }
      setAttributeNS(_ns: string | null, name: string, value: string): void {
        this.setAttribute(name, value);
      }
      getAttributeNS(_ns: string | null, name: string): string | null {
        return this.getAttribute(name);
      }
      attach(node: FakeAttr): null {
        node.ownerElement = this;
        this.map.set(node.name, node);
        return null;
      }
      setAttributeNode(node: FakeAttr): null {
        return this.attach(node);
      }
      setAttributeNodeNS(node: FakeAttr): null {
        return this.attach(node);
      }
      removeAttributeNode(node: FakeAttr): FakeAttr {
        this.map.delete(node.name);
        node.ownerElement = null;
        return node;
      }
      get attributes(): FakeMap {
        return new FakeMap(this);
      }
    }
    class FakeMap {
      owner: FakeElement;
      constructor(owner: FakeElement) {
        this.owner = owner;
      }
      setNamedItem(node: FakeAttr): null {
        return this.owner.attach(node);
      }
      setNamedItemNS(node: FakeAttr): null {
        return this.owner.attach(node);
      }
    }
    class FakeIframe extends FakeElement {
      get srcdoc(): string {
        return this.map.get("srcdoc")?.raw ?? "";
      }
      set srcdoc(value: string) {
        this.put("srcdoc", value);
      }
    }

    return { FakeAttr, FakeElement, FakeMap, FakeIframe };
  }

  function setup() {
    const { FakeAttr, FakeElement, FakeMap, FakeIframe } = fakeDom();
    const win = {
      Element: FakeElement,
      Attr: FakeAttr,
      NamedNodeMap: FakeMap,
      HTMLIFrameElement: FakeIframe,
    } as unknown as Realm;
    const ctx = {
      origin,
      realBase: () => base,
      realUrl: () => base,
      toProxy: (raw: string) => `/~/https/site.test/${raw}`,
      fromProxy: (value: string) => value,
    };
    const bridge = createRewriteBridge(ctx, (b) => `<script src="/_g/c.js" data-girici="${b.href}"></script>`);
    const swaps = (url: string) => (url.startsWith("blob:page") ? "blob:boot" : url);
    const hooks = installAttributes(win, ctx as never, bridge, {
      swap: swaps,
      original: (url) => (url === "blob:boot" ? "blob:page" : url),
    });
    return { iframe: new FakeIframe(), FakeAttr, FakeIframe, hooks };
  }
  const code = "<script>go(location)</script>";

  it("rewrites a frame's values through accessors taken at install, whatever the page replaced later", () => {
    const { iframe, FakeAttr } = setup();
    const elementProto = Object.getPrototypeOf(Object.getPrototypeOf(iframe)) as object;
    withReplaced(elementProto, "localName", { get: () => "div" }, () => iframe.setAttribute("srcdoc", code));
    expect(iframe.map.get("srcdoc")?.raw).toContain("data-girici");
    const node = new FakeAttr("srcdoc", "");
    iframe.setAttributeNode(node);
    withReplaced(FakeAttr.prototype, "ownerElement", { get: () => null }, () => {
      node.value = code;
    });
    expect(node.raw).toContain("data-girici");
  });

  it("installs every hook when the page replaced the array iterator before the frame was adopted", () => {
    const { iframe } = withReplaced(Array.prototype, Symbol.iterator, { value: function* () {} }, () => setup());
    iframe.srcdoc = code;
    expect(iframe.map.get("srcdoc")?.raw).toContain("data-girici");
    iframe.setAttribute("src", "https://b.test/");
    expect(iframe.map.get("src")?.raw).toBe("/~/https/b.test/");
  });

  it("rewrites the values of a frame a parser outside the hooks made, once", () => {
    const { iframe, hooks } = setup();
    iframe.put("srcdoc", code);
    iframe.put("src", "blob:page2");
    hooks.normalize(iframe);
    const rewritten = iframe.map.get("srcdoc")?.raw;
    expect(rewritten).toContain("data-girici");
    expect(iframe.srcdoc).toBe(code);
    expect(iframe.map.get("src")?.raw).toBe("blob:boot");
    hooks.normalize(iframe);
    expect(iframe.map.get("srcdoc")?.raw).toBe(rewritten);
    expect(iframe.map.get("src")?.raw).toBe("blob:boot");
  });

  it("reads the page's own string back through the property and getAttribute", () => {
    const { iframe } = setup();
    iframe.srcdoc = code;
    expect(iframe.map.get("srcdoc")?.raw).toContain("__g$");
    expect(iframe.srcdoc).toBe(code);
    iframe.setAttribute("srcdoc", code);
    expect(iframe.getAttribute("srcdoc")).toBe(code);
    expect(iframe.map.get("srcdoc")?.value).toBe(code);
  });

  it("falls back to the plain form when the attribute changed behind the hooks", () => {
    const { iframe } = setup();
    iframe.srcdoc = code;
    const attr = iframe.map.get("srcdoc") as { raw: string };
    attr.raw = `<script src="/_g/c.js" data-girici="https://site.test/dir/page.html"></script><p>y</p>`;
    expect(iframe.srcdoc).toBe("<p>y</p>");
  });

  it("runs an Attr node attached whole through the srcdoc hooks", () => {
    const { iframe, FakeAttr, FakeIframe } = setup();
    const node = new FakeAttr("srcdoc", code);
    iframe.setAttributeNode(node);
    expect(node.raw).toContain("data-girici");
    expect(iframe.srcdoc).toBe(code);
    const other = new FakeIframe();
    const named = new FakeAttr("srcdoc", code);
    other.attributes.setNamedItem(named);
    expect(named.raw).toContain("data-girici");
    expect(other.srcdoc).toBe(code);
  });

  it("does not add a second runtime tag when an Attr is attached again", () => {
    const { iframe, FakeAttr, FakeIframe } = setup();
    const node = new FakeAttr("srcdoc", "<p>x</p>" + code);
    iframe.setAttributeNode(node);
    const first = node.raw;
    iframe.removeAttributeNode(node);
    expect(node.value).toBe("<p>x</p>" + code);
    iframe.setAttributeNode(node);
    expect(node.raw).toBe(first);
    expect(iframe.srcdoc).toBe("<p>x</p>" + code);
    const moved = new FakeIframe();
    moved.setAttributeNode(node.cloneNode());
    expect(moved.map.get("srcdoc")?.raw.match(/data-girici/g)).toHaveLength(1);
    expect(moved.srcdoc).toContain("<p>x</p>");
  });
});
