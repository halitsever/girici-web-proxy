import { describe, expect, it } from "vitest";
import { installScriptText, scriptKindOf, type ScriptText } from "../src/client/script-text.ts";
import type { Realm } from "../src/client/url-context.ts";
import { REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";

/** A DOM whose text lives in `stored` behind prototype accessors, as the browser's own accessors are. */
function fakeDom() {
  class FakeNode {
    stored = "";
    connected = false;
    readonly kind: number;
    constructor(kind: number) {
      this.kind = kind;
    }
    // One getter for every node type, as in the DOM.
    get nodeType(): number {
      if (!(this instanceof FakeNode)) throw new TypeError("Illegal invocation");
      return this.kind;
    }
    get isConnected(): boolean {
      return this.connected;
    }
    parent: FakeNode | null = null;
    get parentNode(): FakeNode | null {
      return this.parent;
    }
    get childNodes(): FakeNodeList {
      return new FakeNodeList((this as unknown as { children?: FakeNode[] }).children ?? []);
    }
    get textContent(): string {
      return this.stored;
    }
    set textContent(value: string) {
      const self = this as unknown as { writtenAs?: unknown[]; attributes?: Record<string, string> };
      self.writtenAs?.push(self.attributes?.type ?? null);
      this.stored = String(value);
    }
  }
  class FakeCharacterData extends FakeNode {
    get data(): string {
      return this.stored;
    }
    set data(value: string) {
      this.stored = String(value);
    }
  }
  class FakeText extends FakeCharacterData {
    constructor() {
      super(3);
    }
  }
  class FakeNodeList {
    readonly #items: FakeNode[];
    constructor(items: FakeNode[]) {
      this.#items = items;
      items.forEach((item, index) => Object.defineProperty(this, index, { value: item }));
    }
    get length(): number {
      return this.#items.length;
    }
  }
  const scriptsIn = (children: FakeNode[]) =>
    new FakeNodeList(children.filter((child) => child instanceof FakeElement && child.name === "script"));
  class FakeElement extends FakeNode {
    readonly name: string;
    readonly namespace: string;
    readonly attributes: Record<string, string>;
    readonly children: FakeNode[];
    constructor(name: string, attributes: Record<string, string> = {}, namespace = HTML, children: FakeNode[] = []) {
      super(1);
      this.name = name;
      this.attributes = attributes;
      this.namespace = namespace;
      this.children = children;
    }
    get localName(): string {
      return this.name;
    }
    get namespaceURI(): string {
      return this.namespace;
    }
    getAttribute(name: string): string | null {
      return this.attributes[name] ?? null;
    }
    setAttribute(name: string, value: string): void {
      this.attributes[name.toLowerCase()] = String(value);
    }
    removeAttribute(name: string): void {
      delete this.attributes[name.toLowerCase()];
    }
    toggleAttribute(name: string, force?: boolean): boolean {
      const present = force ?? !(name in this.attributes);
      if (present) this.attributes[name] ??= "";
      else delete this.attributes[name];
      return present;
    }
    querySelectorAll(): FakeNodeList {
      return scriptsIn(this.children);
    }
  }
  class FakeHTMLElement extends FakeElement {
    get innerText(): string {
      return this.stored;
    }
    set innerText(value: string) {
      this.stored = String(value);
    }
  }
  // Trusted Types gives script elements their own textContent and innerText, shadowing Node's and HTMLElement's.
  class FakeHTMLScriptElement extends FakeHTMLElement {
    /** The type each native text write saw, so a test can tell whether the browser would have run it. */
    readonly writtenAs: Array<string | null> = [];
    get type(): string {
      return this.attributes.type ?? "";
    }
    set type(value: string) {
      this.attributes.type = String(value);
    }
    get text(): string {
      return this.stored;
    }
    set text(value: string) {
      this.stored = String(value);
    }
    override get textContent(): string {
      return this.stored;
    }
    override set textContent(value: string) {
      this.stored = String(value);
    }
    override get innerText(): string {
      return this.stored;
    }
    override set innerText(value: string) {
      this.stored = String(value);
    }
  }
  class FakeDocumentFragment extends FakeNode {
    readonly children: FakeNode[];
    constructor(children: FakeNode[]) {
      super(11);
      this.children = children;
    }
    querySelectorAll(): FakeNodeList {
      return scriptsIn(this.children);
    }
  }
  const win = {
    Node: FakeNode,
    CharacterData: FakeCharacterData,
    Text: FakeText,
    Element: FakeElement,
    HTMLElement: FakeHTMLElement,
    HTMLScriptElement: FakeHTMLScriptElement,
    DocumentFragment: FakeDocumentFragment,
    NodeList: FakeNodeList,
  } as unknown as Realm;
  const scripts = installScriptText(win, {
    classic: (code) => `[js:${code}]`,
    module: (code) => `[mod:${code}]`,
    importMap: (text) => `[map:${text}]`,
  });
  type Script = FakeHTMLScriptElement & { text: string; textContent: string; innerText: string };
  const dom = {
    script(options: { type?: string; src?: string; connected?: boolean; stored?: string } = {}): Script {
      const attributes: Record<string, string> = {};
      if (options.type !== undefined) attributes.type = options.type;
      if (options.src !== undefined) attributes.src = options.src;
      const script = new FakeHTMLScriptElement("script", attributes) as Script;
      script.connected = options.connected ?? false;
      script.stored = options.stored ?? "";
      return script;
    },
    svgScript(stored: string) {
      const script = new FakeElement("script", {}, SVG);
      script.stored = stored;
      return script as FakeElement & { textContent: string };
    },
    element(name: string, children: FakeNode[] = []) {
      return new FakeHTMLElement(name, {}, HTML, children) as FakeHTMLElement & { textContent: string };
    },
    fragment: (...children: FakeNode[]) => new FakeDocumentFragment(children),
    text(data: string) {
      const text = new FakeText();
      text.stored = data;
      return text;
    },
    nativeText: (node: FakeNode) => node.stored,
  };
  return { dom, scripts: scripts as ScriptText, protos: { FakeElement, FakeNode, FakeCharacterData } };
}

describe("scriptKindOf", () => {
  it("tells a script's kind from its type as the browser does", () => {
    expect(scriptKindOf(null)).toBe("classic");
    expect(scriptKindOf("")).toBe("classic");
    expect(scriptKindOf(" text/JavaScript ")).toBe("classic");
    expect(scriptKindOf("application/x-ecmascript")).toBe("classic");
    expect(scriptKindOf("text/javascript1.5")).toBe("classic");
    expect(scriptKindOf("text/jscript")).toBe("classic");
    expect(scriptKindOf("MODULE")).toBe("module");
    expect(scriptKindOf("importmap")).toBe("importmap");
    expect(scriptKindOf("speculationrules")).toBe("speculationrules");
    expect(scriptKindOf("text/javascript; charset=utf-8")).toBe("data");
    expect(scriptKindOf("text/babel")).toBe("data");
    expect(scriptKindOf("application/ld+json")).toBe("data");
  });
});

describe("installScriptText", () => {
  it("rewrites code written through text, textContent and innerText and reads it back as written", () => {
    const { dom } = fakeDom();
    for (const property of ["text", "textContent", "innerText"] as const) {
      const script = dom.script();
      script[property] = "location.href = '/x'";
      expect(dom.nativeText(script)).toBe("[js:location.href = '/x']");
      expect(script[property]).toBe("location.href = '/x'");
    }
  });

  it("leaves data blocks, templates and other elements alone", () => {
    const { dom } = fakeDom();
    for (const type of ["application/json", "application/ld+json", "text/x-template", "text/plain"]) {
      const script = dom.script({ type });
      script.textContent = '{"a":1}';
      expect(dom.nativeText(script)).toBe('{"a":1}');
    }
    const div = dom.element("div");
    div.textContent = "location";
    expect(dom.nativeText(div)).toBe("location");
  });

  it("rewrites modules as modules, import maps as maps and empties speculation rules", () => {
    const { dom } = fakeDom();
    const module = dom.script({ type: "module" });
    module.textContent = "import.meta.url";
    expect(dom.nativeText(module)).toBe("[mod:import.meta.url]");
    const map = dom.script({ type: "importmap" });
    map.text = '{"imports":{}}';
    expect(dom.nativeText(map)).toBe('[map:{"imports":{}}]');
    const rules = dom.script({ type: "speculationrules" });
    rules.textContent = '{"prefetch":[]}';
    expect(dom.nativeText(rules)).toBe("");
    expect(rules.textContent).toBe('{"prefetch":[]}');
    const svg = dom.svgScript("");
    svg.textContent = "location";
    expect(dom.nativeText(svg)).toBe("[js:location]");
  });

  it("reads the native text once the page changed it some other way", () => {
    const { dom } = fakeDom();
    const script = dom.script();
    script.textContent = "a";
    script.stored = "b";
    expect(script.textContent).toBe("b");
  });

  it("rewrites a script inserted with text the hooks never saw, once", () => {
    const { dom, scripts } = fakeDom();
    const parent = dom.element("div");
    const script = dom.script({ stored: "x" });
    scripts.check([script], parent);
    expect(dom.nativeText(script)).toBe("[js:x]");
    scripts.check([script], parent);
    expect(dom.nativeText(script)).toBe("[js:x]");
    expect(script.textContent).toBe("x");
    const connected = dom.script({ connected: true, stored: "y" });
    scripts.check([connected], parent);
    expect(dom.nativeText(connected)).toBe("y");
    const external = dom.script({ src: "/a.js", stored: "config" });
    scripts.check([external], parent);
    expect(dom.nativeText(external)).toBe("config");
  });

  it("rewrites again for the kind a script has when it goes in", () => {
    const { dom, scripts } = fakeDom();
    const script = dom.script();
    script.textContent = "a";
    script.attributes.type = "module";
    scripts.check([script], dom.element("div"));
    expect(dom.nativeText(script)).toBe("[mod:a]");
    expect(script.textContent).toBe("a");
    script.attributes.type = "application/json";
    scripts.check([script], dom.element("div"));
    expect(dom.nativeText(script)).toBe("a");
  });

  it("finds the scripts inside an inserted fragment", () => {
    const { dom, scripts } = fakeDom();
    const first = dom.script({ stored: "a" });
    const second = dom.script({ stored: "b" });
    scripts.check([dom.fragment(first, dom.element("p"), second)], dom.element("div"));
    expect([dom.nativeText(first), dom.nativeText(second)]).toEqual(["[js:a]", "[js:b]"]);
    const nested = dom.script({ stored: "c" });
    scripts.check([dom.element("div", [nested])], dom.element("body"));
    expect(dom.nativeText(nested)).toBe("[js:c]");
  });

  it("rewrites a text node added to an empty script", () => {
    const { dom, scripts } = fakeDom();
    const script = dom.script({ connected: true });
    const text = dom.text("z");
    scripts.check([text], script);
    expect(dom.nativeText(text)).toBe("[js:z]");
    // The insertion itself, which the backstop runs before.
    script.stored = text.stored;
    expect(script.textContent).toBe("z");
    scripts.check([script], dom.element("div"));
    expect(dom.nativeText(script)).toBe("[js:z]");
    const full = dom.script({ connected: true, stored: "a" });
    const more = dom.text("b");
    scripts.check([more], full);
    expect(dom.nativeText(more)).toBe("b");
    const other = dom.text("location");
    scripts.check([other], dom.element("div"));
    scripts.check([other], null);
    expect(dom.nativeText(other)).toBe("location");
  });

  it("joins strings going into an empty script and rewrites them as one", () => {
    const { dom, scripts } = fakeDom();
    const script = dom.script({ connected: true });
    const args: unknown[] = ["location", ".href"];
    scripts.check(args, script);
    expect(args).toEqual(["[js:location.href]", ""]);
    const data = dom.script({ connected: true, type: "application/json" });
    const block: unknown[] = ['{"a":', "1}"];
    scripts.check(block, data);
    expect(block).toEqual(['{"a":', "1}"]);
  });

  it("joins the text nodes of a fragment going into an empty script", () => {
    const { dom, scripts } = fakeDom();
    const script = dom.script({ connected: true });
    const first = dom.text("location");
    const second = dom.text(".href");
    scripts.check([dom.fragment(first, dom.element("b"), second)], script);
    expect([dom.nativeText(first), dom.nativeText(second)]).toEqual(["[js:location.href]", ""]);
  });

  it("adds text to what Girici wrote into a script and rewrites the whole", () => {
    const { dom, scripts } = fakeDom();
    const script = dom.script({ connected: true });
    script.text = "location";
    const more = dom.text(".href");
    scripts.check([more], script);
    expect([dom.nativeText(script), dom.nativeText(more)]).toEqual(["", "[js:location.href]"]);
    // The insertion itself.
    script.stored = more.stored;
    expect(script.text).toBe("location.href");
    const own = dom.text("x");
    own.parent = script;
    scripts.check([own], script);
    expect(dom.nativeText(own)).toBe("x");
  });

  it("rewrites a connected data block that becomes code while it is still data", () => {
    const { dom } = fakeDom();
    const switches: Array<[string, (script: ReturnType<typeof dom.script>) => void, string]> = [
      ["setAttribute", (script) => script.setAttribute("TYPE", "module"), "[mod:x]"],
      ["removeAttribute", (script) => script.removeAttribute("type"), "[js:x]"],
      ["toggleAttribute", (script) => script.toggleAttribute("type"), "[js:x]"],
      ["type", (script) => (script.type = "text/javascript"), "[js:x]"],
    ];
    for (const [name, change, native] of switches) {
      const script = dom.script({ connected: true, type: "text/plain", stored: "x" });
      change(script);
      expect(dom.nativeText(script), name).toBe(native);
      expect(script.writtenAs, name).toEqual(["text/plain"]);
      expect(script.textContent, name).toBe("x");
    }
    const loose = dom.script({ type: "text/plain", stored: "x" });
    loose.setAttribute("type", "module");
    const stays = dom.script({ connected: true, type: "text/plain", stored: "x" });
    stays.setAttribute("type", "application/json");
    const external = dom.script({ connected: true, type: "text/plain", src: "/a.js", stored: "x" });
    external.type = "";
    expect([dom.nativeText(loose), dom.nativeText(stays), dom.nativeText(external)]).toEqual(["x", "x", "x"]);
    // Converted as the native call converts them, which refuses a symbol.
    const symbol = Symbol("t") as never;
    expect(() => stays.setAttribute("type", symbol)).toThrow(TypeError);
    expect(() => (stays.type = symbol)).toThrow(TypeError);
    expect(() => (stays.text = symbol)).toThrow(TypeError);
  });

  it("ignores values that are not nodes", () => {
    const { dom, scripts } = fakeDom();
    for (const value of [null, undefined, 1, {}, dom.script]) scripts.check([value], dom.script());
    expect(scripts.isScript({})).toBe(false);
    expect(scripts.isScript(dom.text("x"))).toBe(false);
    expect(scripts.isScript(dom.script())).toBe(true);
  });

  describe("with built-ins the page replaced", () => {
    const scenario = ({ dom, scripts }: ReturnType<typeof fakeDom>) => {
      const set = dom.script();
      set.textContent = "a";
      const inserted = dom.script({ stored: "b" });
      scripts.check([dom.fragment(inserted)], dom.element("div"));
      const empty = dom.script({ connected: true });
      const text = dom.text("c");
      scripts.check([text], empty);
      const data = dom.script({ type: "application/json" });
      data.textContent = "d";
      const strings: unknown[] = ["e"];
      scripts.check(strings, dom.script({ connected: true }));
      const block = dom.script({ connected: true, type: "text/plain", stored: "f" });
      block.setAttribute("type", "module");
      return [
        dom.nativeText(set),
        set.textContent,
        dom.nativeText(inserted),
        inserted.textContent,
        text.stored,
        data.stored,
        strings[0],
        block.stored,
      ];
    };
    const expected = ["[js:a]", "a", "[js:b]", "b", "[js:c]", "d", "[js:e]", "[mod:f]"];
    type Replacement = (setup: ReturnType<typeof fakeDom>) => [object, PropertyKey, PropertyDescriptor];
    const replaced: Array<[string, Replacement]> = [
      ...REPLACED_BUILTINS.map(([name, target, key, descriptor]): [string, Replacement] => [
        name,
        () => [target, key, descriptor],
      ]),
      ["WeakMap.prototype.get", () => [WeakMap.prototype, "get", { value: () => ({ native: "", original: "page" }) }]],
      ["WeakMap.prototype.set", () => [WeakMap.prototype, "set", { value: () => undefined }]],
      ["Set.prototype.has", () => [Set.prototype, "has", { value: () => false }]],
      [
        "Element.prototype.getAttribute",
        ({ protos }) => [protos.FakeElement.prototype, "getAttribute", { value: () => "application/json" }],
      ],
      [
        "Element.prototype.localName",
        ({ protos }) => [protos.FakeElement.prototype, "localName", { get: () => "div" }],
      ],
      [
        "Element.prototype.querySelectorAll",
        ({ protos }) => [protos.FakeElement.prototype, "querySelectorAll", { value: () => [] }],
      ],
      ["Node.prototype.nodeType", ({ protos }) => [protos.FakeNode.prototype, "nodeType", { get: () => 3 }]],
      ["Node.prototype.isConnected", ({ protos }) => [protos.FakeNode.prototype, "isConnected", { get: () => true }]],
      [
        "CharacterData.prototype.data",
        ({ protos }) => [protos.FakeCharacterData.prototype, "data", { get: () => "", set: () => {} }],
      ],
    ];
    for (const [name, replacement] of replaced) {
      it(`reads and writes script text with natives taken at install when ${name} is replaced`, () => {
        const setup = fakeDom();
        const [target, key, descriptor] = replacement(setup);
        expect(withReplaced(target, key, descriptor, () => scenario(setup))).toEqual(expected);
      });
    }

    it("keeps its records when Object.prototype carries native and original", () => {
      const setup = fakeDom();
      const additions = { native: { value: "[js:b]", writable: true }, original: { value: "page", writable: true } };
      const seen = withPrototypeAdditions(additions, () => {
        const plain = setup.dom.script({ stored: "[js:b]" });
        return [plain.textContent, ...scenario(setup)];
      });
      expect(seen).toEqual(["[js:b]", ...expected]);
    });
  });
});
