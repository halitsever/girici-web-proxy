import {
  append,
  apply,
  define,
  inheritedGetter,
  lowerCase,
  NativeWeakMap,
  setHas,
  stringOf,
  toText,
  trim,
} from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm } from "./url-context.ts";

export type ScriptKind = "classic" | "module" | "importmap" | "speculationrules" | "data";

export interface ScriptRewriters {
  classic(code: string): string;
  module(code: string): string;
  importMap(text: string): string;
}

export interface ScriptText {
  /** An HTML or SVG script element; both run their text. */
  isScript(target: unknown): boolean;
  /** The text for the native setter when the page writes `text` into a script. */
  write(target: unknown, text: string): string;
  /** What the page wrote, while the script still holds the text written for it. */
  read(target: unknown, text: string): string;
  /** Runs before `nodes` go into `target`, for script text no setter saw; may put a rewrite in place of a string. */
  check(nodes: unknown[], target: unknown): void;
}

interface ScriptRecord {
  native: string;
  original: string;
  kind: ScriptKind;
}

/** Stands in when the hooks could not be installed, so the sinks treat every target as markup. */
export const NO_SCRIPT_TEXT: ScriptText = Object.freeze({
  isScript: () => false,
  write: (_target: unknown, text: string) => text,
  read: (_target: unknown, text: string) => text,
  check: () => {},
});

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const DOCUMENT_NODE = 9;
const FRAGMENT_NODE = 11;

// Taken at load: these run inside page calls, after page code may have replaced the originals.
const ownDescriptor = Reflect.getOwnPropertyDescriptor;
const protoOf = Reflect.getPrototypeOf;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;
const mapDelete = WeakMap.prototype.delete;

/** The JavaScript MIME essences, with the versioned and x- forms the HTML rewriter also runs as classic. */
const JAVASCRIPT_TYPES = new Set(["text/jscript", "text/livescript"]);
for (const top of ["text/", "application/"])
  for (const prefix of ["", "x-"])
    for (const language of ["javascript", "ecmascript"])
      for (const version of ["", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"])
        JAVASCRIPT_TYPES.add(top + prefix + language + version);

/** How a script with this `type` attribute runs, as `rewrite/html.ts` reads it for markup. */
export function scriptKindOf(type: string | null): ScriptKind {
  const value = type === null ? "" : lowerCase(trim(type));
  if (value === "" || setHas(JAVASCRIPT_TYPES, value)) return "classic";
  if (value === "module" || value === "importmap" || value === "speculationrules") return value;
  return "data";
}

/**
 * Script text a page writes at run time is rewritten before the browser can run it, and read back as the page wrote
 * it. Data blocks keep their text.
 */
export function installScriptText(win: Realm, rewrite: ScriptRewriters): ScriptText {
  const classic = rewrite.classic;
  const module = rewrite.module;
  const importMap = rewrite.importMap;
  const node = win.Node.prototype;
  const element = win.Element.prototype;
  const nodeTypeOf = ownDescriptor(node, "nodeType")?.get;
  const connectedOf = ownDescriptor(node, "isConnected")?.get;
  const textContent = ownDescriptor(node, "textContent");
  const localNameOf = ownDescriptor(element, "localName")?.get;
  const namespaceOf = ownDescriptor(element, "namespaceURI")?.get;
  const getAttribute = element.getAttribute;
  const childNodesOf = ownDescriptor(node, "childNodes")?.get;
  const parentOf = ownDescriptor(node, "parentNode")?.get;
  const data = accessorOf(win.Text.prototype, "data");
  const listLength = ownDescriptor(win.NodeList.prototype, "length")?.get;
  const elementQuery = element.querySelectorAll;
  const fragmentQuery = win.DocumentFragment?.prototype.querySelectorAll;
  const records = new NativeWeakMap<object, ScriptRecord>();

  const nodeType = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null || !nodeTypeOf) return 0;
    try {
      return apply(nodeTypeOf, value, []);
    } catch {
      // Not a node.
      return 0;
    }
  };
  const isScript = (target: unknown): boolean => {
    if (nodeType(target) !== ELEMENT_NODE || !localNameOf || apply(localNameOf, target, []) !== "script") return false;
    const namespace = namespaceOf ? apply(namespaceOf, target, []) : HTML_NAMESPACE;
    return namespace === HTML_NAMESPACE || namespace === SVG_NAMESPACE;
  };
  const attribute = (script: unknown, name: string) => apply(getAttribute, script, [name]) as string | null;
  const kindOf = (script: unknown) => scriptKindOf(attribute(script, "type"));
  const nativeText = (script: unknown) => (textContent?.get ? toText(apply(textContent.get, script, [])) : "");
  const recordOf = (script: unknown) => apply(mapGet, records, [script]) as ScriptRecord | undefined;

  const rewriteAs = (kind: ScriptKind, text: string): string => {
    if (kind === "classic") return classic(text);
    if (kind === "module") return module(text);
    if (kind === "importmap") return importMap(text);
    // The HTML rewriter drops these too: prefetch and prerender rules would reach real sites.
    return kind === "speculationrules" ? "" : text;
  };
  const remember = (script: unknown, kind: ScriptKind, original: string): string => {
    const native = rewriteAs(kind, original);
    if (kind === "data") apply(mapDelete, records, [script]);
    else apply(mapSet, records, [script, { __proto__: null, native, original, kind } as ScriptRecord]);
    return native;
  };
  const write = (target: unknown, text: string): string =>
    isScript(target) ? remember(target, kindOf(target), text) : text;
  const read = (target: unknown, text: string): string => {
    if (typeof target !== "object" || target === null) return text;
    const record = recordOf(target);
    return record && record.native === text ? record.original : text;
  };

  /** A connected script already ran or never will from this text; an external one runs its src instead. */
  const settle = (script: unknown): void => {
    if (!isScript(script) || (connectedOf && apply(connectedOf, script, [])) || attribute(script, "src") !== null)
      return;
    const text = nativeText(script);
    const kind = kindOf(script);
    const record = recordOf(script);
    const known = record !== undefined && record.native === text;
    // Its type may have changed since the text went in.
    if (known && record.kind === kind) return;
    const original = known ? record.original : text;
    if (original === "") return;
    const next = remember(script, kind, original);
    if (next !== text && textContent?.set) apply(textContent.set, script, [next]);
  };
  /** The text a script holds that Girici can stand behind: none, or what it wrote there itself. */
  const ownText = (script: unknown): string | null => {
    const text = nativeText(script);
    if (text === "") return "";
    const record = recordOf(script);
    return record !== undefined && record.native === text ? record.original : null;
  };
  /**
   * A connected script that has not run yet runs all of its text once more goes in, so the new text is joined to what
   * it holds and rewritten as one. Text Girici did not write is left alone: it may already be rewritten.
   */
  const textInto = (nodes: unknown[], target: unknown): void => {
    if (!data || !isScript(target) || attribute(target, "src") !== null) return;
    const before = ownText(target);
    if (before === null) return;
    // Where each piece lives: an index into `nodes` for a string, else the text node itself.
    const holders: unknown[] = [];
    let added = "";
    const take = (text: unknown): boolean => {
      if (parentOf && apply(parentOf, text, []) === target) return false;
      added += toText(apply(data.get, text, []));
      append(holders, text);
      return true;
    };
    for (let index = 0; index < nodes.length; index++) {
      const value = nodes[index];
      if (typeof value === "string") {
        added += value;
        append(holders, index);
        continue;
      }
      const type = nodeType(value);
      if (type === TEXT_NODE && !take(value)) return;
      if (type !== FRAGMENT_NODE || !childNodesOf || !listLength) continue;
      const children = apply(childNodesOf, value, []) as NodeList;
      const length = apply(listLength, children, []) as number;
      for (let child = 0; child < length; child++) if (nodeType(children[child]) === TEXT_NODE) take(children[child]);
    }
    if (added === "") return;
    const whole = before + added;
    const next = remember(target, kindOf(target), whole);
    if (next === whole && before === "") return;
    // Emptied first, so the script holds only the rewrite once the insertion lands.
    if (before !== "" && textContent?.set) apply(textContent.set, target, [""]);
    for (let index = 0; index < holders.length; index++) {
      const holder = holders[index];
      const value = index === 0 ? next : "";
      if (typeof holder === "number") nodes[holder] = value;
      else apply(data.set, holder, [value]);
    }
  };
  const checkOne = (inserted: unknown): void => {
    const type = nodeType(inserted);
    if (type !== ELEMENT_NODE && type !== FRAGMENT_NODE) return;
    // A node being moved within the document holds only scripts that are connected too.
    if (type === ELEMENT_NODE && connectedOf && apply(connectedOf, inserted, [])) return;
    settle(inserted);
    const query = type === ELEMENT_NODE ? elementQuery : fragmentQuery;
    if (!query || !listLength) return;
    try {
      const found = apply(query, inserted, ["script"]) as NodeListOf<Element>;
      const length = apply(listLength, found, []) as number;
      for (let index = 0; index < length; index++) settle(found[index]);
    } catch {
      // The insertion that follows reports whatever is wrong with this node.
    }
  };
  const check = (nodes: unknown[], target: unknown): void => {
    textInto(nodes, target);
    for (let index = 0; index < nodes.length; index++) checkOne(nodes[index]);
  };

  /**
   * A connected data block that becomes code runs its text once more goes in. Rewritten while it is still data, the
   * browser does not run it on the change.
   */
  const typeChange = (script: unknown, next: string | null): void => {
    if (!isScript(script) || attribute(script, "src") !== null || !connectedOf || !apply(connectedOf, script, []))
      return;
    const kind = scriptKindOf(next);
    if (kind === "data" || kindOf(script) !== "data") return;
    const text = nativeText(script);
    if (text === "") return;
    const native = rewriteAs(kind, text);
    apply(mapSet, records, [script, { __proto__: null, native, original: text, kind } as ScriptRecord]);
    if (native !== text && textContent?.set) apply(textContent.set, script, [native]);
  };
  hookTypeChanges(win, isScript, attribute, typeChange);
  hookSurroundContents(win, isScript, attribute);

  const hook = (proto: object | undefined, name: string, convert: (value: unknown) => string): void => {
    const descriptor = proto && ownDescriptor(proto, name);
    const get = descriptor?.get;
    const set = descriptor?.set;
    if (!proto || !get || !set) return;
    define(proto, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get: maskNative(function (this: unknown) {
        const value: unknown = apply(get, this, []);
        return typeof value === "string" ? read(this, value) : value;
      }, get),
      set: maskNative(function (this: unknown, value: unknown) {
        apply(set, this, [isScript(this) ? write(this, convert(value)) : value]);
      }, set),
    });
  };
  // Each converts as its IDL type does, since the setter now gets a string.
  const toContent = (value: unknown) => (value === null || value === undefined ? "" : stringOf(value));
  const toInnerText = (value: unknown) => (value === null ? "" : stringOf(value));
  const script = win.HTMLScriptElement?.prototype;
  hook(node, "textContent", toContent);
  hook(win.HTMLElement?.prototype, "innerText", toInnerText);
  // Trusted Types gives script elements their own textContent and innerText, which shadow the two above.
  hook(script, "textContent", toContent);
  hook(script, "innerText", toInnerText);
  hook(script, "text", stringOf);

  return { isScript, write, read, check };
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/** The calls that change a script's `type`: its property and the attribute methods named "type". */
function hookTypeChanges(
  win: Realm,
  isScript: (target: unknown) => boolean,
  attribute: (script: unknown, name: string) => string | null,
  change: (script: unknown, next: string | null) => void,
): void {
  const element = win.Element.prototype;
  const wrap = (proto: object | undefined, name: string, before: (self: unknown, args: unknown[]) => void) => {
    const descriptor = proto && ownDescriptor(proto, name);
    const native = descriptor?.value as AnyFunction | undefined;
    if (!proto || typeof native !== "function") return;
    const hooked = function (this: unknown, ...args: unknown[]): unknown {
      if (isScript(this)) before(this, args);
      return apply(native, this, args);
    };
    define(proto, name, { ...descriptor, value: maskNative(hooked, native) });
  };
  /** Converted once here, so the native call does not run a page's toString a second time. */
  const named = (args: unknown[], index: number): boolean => {
    const name = (args[index] = stringOf(args[index]));
    return lowerCase(name) === "type";
  };
  const plainNamespace = (value: unknown) => value === null || value === undefined || value === "";
  wrap(element, "setAttribute", (self, args) => {
    if (args.length < 2 || !named(args, 0)) return;
    change(self, (args[1] = stringOf(args[1])));
  });
  wrap(element, "setAttributeNS", (self, args) => {
    if (args.length < 3 || !plainNamespace(args[0]) || !named(args, 1)) return;
    change(self, (args[2] = stringOf(args[2])));
  });
  wrap(element, "removeAttribute", (self, args) => {
    if (args.length > 0 && named(args, 0)) change(self, null);
  });
  wrap(element, "removeAttributeNS", (self, args) => {
    if (args.length > 1 && plainNamespace(args[0]) && named(args, 1)) change(self, null);
  });
  wrap(element, "toggleAttribute", (self, args) => {
    if (args.length === 0 || !named(args, 0)) return;
    const current = attribute(self, "type");
    const present = args.length > 1 ? !!args[1] : current === null;
    change(self, present ? (current ?? "") : null);
  });
  const script = win.HTMLScriptElement?.prototype;
  const property = script && ownDescriptor(script, "type");
  const set = property?.set;
  if (!script || !property || !set) return;
  define(script, "type", {
    ...property,
    set: maskNative(function (this: unknown, value: unknown) {
      const next = stringOf(value);
      if (isScript(this)) change(this, next);
      apply(set, this, [next]);
    }, set),
  });
}

/**
 * surroundContents puts a range's text into an empty, connected script, which then runs it. Done here in steps, the
 * text goes in through appendChild, whose backstop rewrites it.
 */
function hookSurroundContents(
  win: Realm,
  isScript: (target: unknown) => boolean,
  attribute: (script: unknown, name: string) => string | null,
): void {
  const range = win.Range?.prototype;
  const descriptor = range && ownDescriptor(range, "surroundContents");
  const surround = descriptor?.value as AnyFunction | undefined;
  if (!range || !win.Document || typeof surround !== "function") return;
  const node = win.Node.prototype;
  const doc = win.Document.prototype;
  const startOf = inheritedGetter(range, "startContainer");
  const selectNode = range?.selectNode as AnyFunction | undefined;
  const ownerOf = ownDescriptor(node, "ownerDocument")?.get;
  const typeOf = ownDescriptor(node, "nodeType")?.get;
  const firstChildOf = ownDescriptor(node, "firstChild")?.get;
  const appendChild = node.appendChild as AnyFunction;
  const createElement = doc.createElement as AnyFunction;
  const createFragment = doc.createDocumentFragment as AnyFunction;
  const replaceChildren = win.Element.prototype.replaceChildren as AnyFunction | undefined;
  const replaceWith = win.Element.prototype.replaceWith as AnyFunction | undefined;
  if (!startOf || !selectNode || !ownerOf || !typeOf || !firstChildOf || !replaceChildren || !replaceWith) return;
  const hooked = function (this: unknown, ...args: unknown[]): unknown {
    const parent = args[0];
    if (!isScript(parent) || attribute(parent, "src") !== null) return apply(surround, this, args);
    const start = apply(startOf, this, []);
    const owner = apply(typeOf, start, []) === DOCUMENT_NODE ? start : apply(ownerOf, start, []);
    const holder = apply(createElement, owner, ["span"]);
    // The browser checks the range and moves its contents as it would for the script.
    apply(surround, this, [holder]);
    const fragment = apply(createFragment, owner, []);
    for (let child = apply(firstChildOf, holder, []); child; child = apply(firstChildOf, holder, []))
      apply(appendChild, fragment, [child]);
    apply(replaceChildren, parent, []);
    apply(replaceWith, holder, [parent]);
    apply(appendChild, parent, [fragment]);
    apply(selectNode, this, [parent]);
    return undefined;
  };
  define(range, "surroundContents", { ...descriptor, value: maskNative(hooked, surround) });
}

interface Accessor {
  get: () => unknown;
  set: (value: unknown) => void;
}

/** `data` lives on CharacterData.prototype, above Text.prototype. */
function accessorOf(start: object | undefined, name: string): Accessor | null {
  for (let current = start ?? null; current; current = protoOf(current)) {
    const descriptor = ownDescriptor(current, name);
    if (!descriptor) continue;
    return descriptor.get && descriptor.set
      ? ({ __proto__: null, get: descriptor.get, set: descriptor.set } as Accessor)
      : null;
  }
  return null;
}
