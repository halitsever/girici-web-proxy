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
    get nodeValue(): string | null {
      return this.kind === 1 ? null : this.stored;
    }
    set nodeValue(value: string) {
      if (this.kind !== 1) this.stored = String(value);
    }
  }
  class FakeCharacterData extends FakeNode {
    get data(): string {
      return this.stored;
    }
    set data(value: string) {
      this.stored = String(value);
    }
    appendData(value: string): void {
      this.stored += value;
    }
    insertData(offset: number, value: string): void {
      this.stored = this.stored.slice(0, offset) + value + this.stored.slice(offset);
    }
    replaceData(offset: number, count: number, value: string): void {
      this.stored = this.stored.slice(0, offset) + value + this.stored.slice(offset + count);
    }
  }
  /** Its value lives in the owner's attributes while it has one. */
  class FakeAttr extends FakeNode {
    readonly name: string;
    owner: FakeElement | null;
    loose = "";
    constructor(name: string, owner: FakeElement | null = null) {
      super(2);
      this.name = name;
      this.owner = owner;
      Object.defineProperty(this, "stored", {
        get: () => (this.owner ? (this.owner.attributes[this.name] ?? "") : this.loose),
        set: (value: string) => {
          if (this.owner) this.owner.attributes[this.name] = value;
          else this.loose = value;
        },
      });
    }
    get localName(): string {
      return this.name;
    }
    get namespaceURI(): null {
      return null;
    }
    get ownerElement(): FakeElement | null {
      return this.owner;
    }
    get value(): string {
      return this.stored;
    }
    set value(value: string) {
      this.stored = String(value);
    }
  }
  const attach = (owner: FakeElement, attr: FakeAttr) => {
    const value = attr.stored;
    attr.owner = owner;
    attr.stored = value;
  };
  const detach = (attr: FakeAttr) => {
    attr.loose = attr.stored;
    if (attr.owner) delete attr.owner.attributes[attr.name];
    attr.owner = null;
  };
  class FakeNamedNodeMap {
    readonly #owner: FakeElement;
    constructor(owner: FakeElement) {
      this.#owner = owner;
    }
    item(index: number): FakeAttr | null {
      const name = Object.keys(this.#owner.attributes)[index];
      return name === undefined ? null : new FakeAttr(name, this.#owner);
    }
    getNamedItem(name: string): FakeAttr | null {
      return this.#owner.getAttributeNode(name);
    }
    getNamedItemNS(_namespace: string | null, name: string): FakeAttr | null {
      return this.#owner.getAttributeNode(name);
    }
    // Each calls the element's own steps directly, as the browser does, not its hooked methods.
    setNamedItem(attr: FakeAttr): void {
      attach(this.#owner, attr);
    }
    setNamedItemNS(attr: FakeAttr): void {
      attach(this.#owner, attr);
    }
    removeNamedItem(name: string): void {
      if (name in this.#owner.attributes) detach(new FakeAttr(name, this.#owner));
    }
    removeNamedItemNS(_namespace: string | null, name: string): void {
      if (name in this.#owner.attributes) detach(new FakeAttr(name, this.#owner));
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
    /** Stands in for the `attributes` map, which the fake keeps as a plain record. */
    namedMap(): FakeNamedNodeMap {
      return new FakeNamedNodeMap(this);
    }
    getAttributeNode(name: string): FakeAttr | null {
      return name in this.attributes ? new FakeAttr(name, this) : null;
    }
    setAttributeNode(attr: FakeAttr): void {
      attach(this, attr);
    }
    setAttributeNodeNS(attr: FakeAttr): void {
      attach(this, attr);
    }
    removeAttributeNode(attr: FakeAttr): void {
      detach(attr);
    }
    /** The script's text stands in for its children, so only the inner positions change it. */
    insertAdjacentText(where: string, text: string): void {
      if (where.toLowerCase() === "beforeend") this.stored += String(text);
      if (where.toLowerCase() === "afterbegin") this.stored = String(text) + this.stored;
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
    Attr: FakeAttr,
    NamedNodeMap: FakeNamedNodeMap,
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
    attr(name: string, value: string) {
      const attr = new FakeAttr(name) as FakeAttr & { textContent: string; nodeValue: string };
      attr.loose = value;
      return attr;
    },
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

  it("rewrites a connected data block whose type changes through an Attr node", () => {
    const { dom } = fakeDom();
    type Script = ReturnType<typeof dom.script>;
    const typeNode = (script: Script) => script.getAttributeNode("type") as ReturnType<typeof dom.attr>;
    const switches: Array<[string, (script: Script) => void, string]> = [
      ["removeNamedItem", (script) => script.namedMap().removeNamedItem("type"), "[js:x]"],
      ["removeNamedItemNS", (script) => script.namedMap().removeNamedItemNS(null, "type"), "[js:x]"],
      ["setNamedItem", (script) => script.namedMap().setNamedItem(dom.attr("type", "module")), "[mod:x]"],
      ["setNamedItemNS", (script) => script.namedMap().setNamedItemNS(dom.attr("type", "")), "[js:x]"],
      ["setAttributeNode", (script) => script.setAttributeNode(dom.attr("type", "module")), "[mod:x]"],
      ["setAttributeNodeNS", (script) => script.setAttributeNodeNS(dom.attr("type", "")), "[js:x]"],
      ["removeAttributeNode", (script) => script.removeAttributeNode(typeNode(script)), "[js:x]"],
      ["Attr.value", (script) => (typeNode(script).value = ""), "[js:x]"],
      ["Attr.nodeValue", (script) => (typeNode(script).nodeValue = "module"), "[mod:x]"],
      ["Attr.textContent", (script) => (typeNode(script).textContent = "text/javascript"), "[js:x]"],
    ];
    for (const [name, change, native] of switches) {
      const script = dom.script({ connected: true, type: "text/plain", stored: "x" });
      change(script);
      expect(dom.nativeText(script), name).toBe(native);
      expect(script.writtenAs, name).toEqual(["text/plain"]);
      expect(script.textContent, name).toBe("x");
    }
    // Owned by another element, the native call refuses it.
    const other = dom.script({ connected: true, type: "module" });
    const taken = dom.script({ connected: true, type: "text/plain", stored: "x" });
    taken.setAttributeNode(other.getAttributeNode("type") as never);
    const data = dom.script({ connected: true, type: "text/plain", stored: "x" });
    data.namedMap().setNamedItem(dom.attr("type", "application/json"));
    (data.getAttributeNode("type") as ReturnType<typeof dom.attr>).value = "text/x-template";
    expect([dom.nativeText(taken), dom.nativeText(data)]).toEqual(["x", "x"]);
  });

  it("rewrites text inserted into a script by insertAdjacentText", () => {
    const { dom } = fakeDom();
    const empty = dom.script({ connected: true });
    empty.insertAdjacentText("BeforeEnd", "location");
    expect(dom.nativeText(empty)).toBe("[js:location]");
    expect(empty.textContent).toBe("location");
    const own = dom.script({ connected: true });
    own.text = ".href";
    own.insertAdjacentText("afterbegin", "location");
    expect(dom.nativeText(own)).toBe("[js:location.href]");
    expect(own.text).toBe("location.href");
    const outside = dom.script({ connected: true });
    outside.insertAdjacentText("beforebegin", "location");
    const data = dom.script({ connected: true, type: "application/json" });
    data.insertAdjacentText("beforeend", '{"a":1}');
    expect([dom.nativeText(outside), dom.nativeText(data)]).toEqual(["", '{"a":1}']);
  });

  it("rewrites text set into the empty text node of a script", () => {
    const { dom } = fakeDom();
    type Text = ReturnType<typeof dom.text> & { nodeValue: string; textContent: string };
    const changes: Array<[string, (text: Text) => void]> = [
      ["data", (text) => (text.data = "location")],
      ["nodeValue", (text) => (text.nodeValue = "location")],
      ["textContent", (text) => (text.textContent = "location")],
      ["appendData", (text) => text.appendData("location")],
      ["insertData", (text) => text.insertData(0, "location")],
      ["replaceData", (text) => text.replaceData(0, 0, "location")],
    ];
    for (const [name, change] of changes) {
      const script = dom.script({ connected: true });
      const text = dom.text("") as Text;
      text.parent = script;
      change(text);
      expect(dom.nativeText(text), name).toBe("[js:location]");
      // The text the script then holds.
      script.stored = text.stored;
      expect(script.textContent, name).toBe("location");
    }
    const full = dom.script({ connected: true, stored: "a" });
    const inFull = dom.text("a");
    inFull.parent = full;
    inFull.appendData("b");
    const loose = dom.text("") as Text;
    loose.data = "location";
    const block = dom.script({ connected: true, type: "application/json" });
    const inBlock = dom.text("") as Text;
    inBlock.parent = block;
    inBlock.data = "location";
    expect([inFull.stored, loose.stored, inBlock.stored]).toEqual(["ab", "location", "location"]);
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
