import { describe, expect, it } from "vitest";
import { installHtmlSinks } from "../src/client/html-sinks.ts";
import type { Realm } from "../src/client/url-context.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const noScripts = {
  isScript: () => false,
  write: (_target: unknown, text: string) => text,
  read: (_t: unknown, text: string) => text,
};

function setup() {
  const parsed: unknown[][] = [];
  class DOMParser {
    parseFromString(source: string, type: unknown) {
      parsed.push([source, type]);
      return {};
    }
  }
  const win = {
    Element: { prototype: {} },
    Document: { prototype: {} },
    Range: { prototype: {} },
    DOMParser,
  } as unknown as Realm;
  installHtmlSinks(
    win,
    (html) => `[${html}]`,
    (html) => html,
    () => {},
    () => {},
    noScripts,
  );
  return { parser: new DOMParser(), parsed };
}

/** A realm whose elements, shadow roots and Document carry the newer HTML methods, recording what they receive. */
function modernSetup() {
  const calls: unknown[][] = [];
  const written: unknown[] = [];
  class FakeNode {
    stored = "";
    script = false;
    get innerHTML(): string {
      return this.stored;
    }
    set innerHTML(value: string) {
      this.stored = value;
    }
    setHTMLUnsafe(...args: unknown[]) {
      calls.push(["setHTMLUnsafe", this as unknown].concat(args));
    }
    setHTML(...args: unknown[]) {
      calls.push(["setHTML", this as unknown].concat(args));
    }
    getHTML(...args: unknown[]) {
      calls.push(["getHTML", this as unknown].concat(args));
      return this.stored;
    }
  }
  class FakeElement extends FakeNode {}
  class FakeShadowRoot extends FakeNode {}
  // Own members of each prototype, as the InnerHTML mixin gives them to Element and ShadowRoot.
  for (const proto of [FakeElement.prototype, FakeShadowRoot.prototype]) {
    for (const name of ["innerHTML", "setHTMLUnsafe", "setHTML", "getHTML"]) {
      Object.defineProperty(proto, name, Object.getOwnPropertyDescriptor(FakeNode.prototype, name)!);
    }
  }
  class FakeDocument {
    static parseHTMLUnsafe(...args: unknown[]) {
      calls.push(["parseHTMLUnsafe" as unknown].concat(args));
      return "unsafe document";
    }
    static parseHTML(...args: unknown[]) {
      calls.push(["parseHTML" as unknown].concat(args));
      return "safe document";
    }
  }
  class DOMParser {
    parseFromString() {
      return {};
    }
  }
  const win = {
    Element: FakeElement,
    ShadowRoot: FakeShadowRoot,
    Document: FakeDocument,
    Range: { prototype: {} },
    DOMParser,
  } as unknown as Realm;
  installHtmlSinks(
    win,
    (html) => `[${html}]`,
    (html) => `{${html}}`,
    (target) => written.push(target),
    () => {},
    {
      isScript: (target) => (target as FakeNode).script,
      write: (_target, text) => `<code:${text}>`,
      read: (_target, text) => `<read:${text}>`,
    },
  );
  type Node = FakeNode & { setHTMLUnsafe(html: unknown, options?: unknown): void };
  const element = () => new FakeElement() as Node;
  const script = () => Object.assign(new FakeElement(), { script: true }) as Node;
  const shadowRoot = () => new FakeShadowRoot() as Node;
  return { calls, written, element, script, shadowRoot, Document: FakeDocument, FakeElement, FakeShadowRoot };
}

describe("installHtmlSinks", () => {
  it("rewrites DOMParser markup for a type object whose methods lie, and parses the type it checked", () => {
    const { parser, parsed } = setup();
    const type = { toString: () => "text/html", endsWith: () => false };
    parser.parseFromString("<iframe srcdoc=x>", type);
    parser.parseFromString("<a/>", "text/xml");
    expect(parsed).toEqual([
      ["[<iframe srcdoc=x>]", "text/html"],
      ["<a/>", "text/xml"],
    ]);
  });

  it("treats markup written into a script as code", () => {
    const { calls, element, script } = modernSetup();
    const code = script();
    code.innerHTML = "location.href";
    expect(code.stored).toBe("<code:location.href>");
    expect(code.innerHTML).toBe("<read:<code:location.href>>");
    code.setHTMLUnsafe("location");
    expect(calls).toEqual([["setHTMLUnsafe", code, "<code:location>"]]);
    const div = element();
    div.innerHTML = "<a>";
    expect(div.stored).toBe("[<a>]");
    expect(div.innerHTML).toBe("{[<a>]}");
  });

  it("rewrites setHTMLUnsafe, setHTML and parseHTMLUnsafe markup and reads getHTML back", () => {
    const { calls, written, element, shadowRoot, Document } = modernSetup();
    const div = element();
    const root = shadowRoot();
    const options = { sanitizer: {} };
    div.setHTMLUnsafe("<a>", options);
    root.setHTMLUnsafe("<b>");
    (div as unknown as { setHTML(html: string, options: unknown): void }).setHTML("<c>", options);
    const parse = Document as unknown as Record<
      "parseHTMLUnsafe" | "parseHTML",
      (html: unknown, options?: unknown) => unknown
    >;
    expect(parse.parseHTMLUnsafe({ toString: () => "<d>" }, options)).toBe("unsafe document");
    expect(parse.parseHTML("<e>")).toBe("safe document");
    div.stored = "<f>";
    expect((div as unknown as { getHTML(options: unknown): string }).getHTML(options)).toBe("{<f>}");
    expect(calls).toEqual([
      ["setHTMLUnsafe", div, "[<a>]", options],
      ["setHTMLUnsafe", root, "[<b>]"],
      ["setHTML", div, "[<c>]", options],
      ["parseHTMLUnsafe", "[<d>]", options],
      ["parseHTML", "[<e>]"],
      ["getHTML", div, options],
    ]);
    expect(written).toEqual([div, root, div]);
  });

  it("reads a script's getHTML back as the code the page wrote", () => {
    const { script } = modernSetup();
    const code = script();
    code.stored = "x";
    expect((code as unknown as { getHTML(): string }).getHTML()).toBe("<read:x>");
  });

  it("leaves prototypes without the new methods alone", () => {
    const element = {};
    const documentCtor = function () {} as unknown as { prototype: object };
    documentCtor.prototype = {};
    installHtmlSinks(
      {
        Element: { prototype: element },
        Document: documentCtor,
        Range: { prototype: {} },
        DOMParser: class {},
      } as unknown as Realm,
      (html) => html,
      (html) => html,
      () => {},
      () => {},
      noScripts,
    );
    for (const name of ["setHTMLUnsafe", "setHTML", "getHTML"]) expect(Object.hasOwn(element, name), name).toBe(false);
    for (const name of ["parseHTMLUnsafe", "parseHTML"]) expect(Object.hasOwn(documentCtor, name), name).toBe(false);
  });

  describe("with built-ins the page replaced", () => {
    const scenario = () => {
      const { calls, element, shadowRoot, script, Document } = modernSetup();
      return () => {
        const div = element();
        div.setHTMLUnsafe("<a>");
        shadowRoot().setHTMLUnsafe("<b>");
        (Document as unknown as { parseHTMLUnsafe(html: string): unknown }).parseHTMLUnsafe("<c>");
        const code = script();
        code.innerHTML = "d";
        div.stored = "<e>";
        return [
          calls.map((call) => call.filter((part) => typeof part === "string")),
          code.stored,
          (div as unknown as { getHTML(): string }).getHTML(),
        ];
      };
    };
    const expected = scenario()();
    const replaced: Array<[string, object, PropertyKey, PropertyDescriptor]> = [
      ...REPLACED_BUILTINS,
      ["String", globalThis, "String", { value: () => "page" }],
      ["Array.prototype[Symbol.iterator]", Array.prototype, Symbol.iterator, { value: function* () {} }],
    ];
    for (const [name, target, key, descriptor] of replaced) {
      it(`rewrites the new sinks when ${name} is replaced`, () => {
        const run = scenario();
        expect(withReplaced(target, key, descriptor, run)).toEqual(expected);
      });
    }
  });
});
