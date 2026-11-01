import { apply, define, lowerCase, NativeWeakMap, setHas, toText, trim } from "../shared/primordials.ts";
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
  /** Runs before `node` goes into `target`, for script text no setter saw. */
  check(node: unknown, target: unknown): void;
}

interface ScriptRecord {
  native: string;
  original: string;
  kind: ScriptKind;
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
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
  /** An empty script runs the first text that goes into it, even when it is already connected. */
  const textInto = (text: unknown, target: unknown): void => {
    if (!data || !isScript(target) || nativeText(target) !== "" || attribute(target, "src") !== null) return;
    const value = toText(apply(data.get, text, []));
    const next = remember(target, kindOf(target), value);
    if (next !== value) apply(data.set, text, [next]);
  };
  const check = (inserted: unknown, target: unknown): void => {
    const type = nodeType(inserted);
    if (type === TEXT_NODE) {
      textInto(inserted, target);
      return;
    }
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
  const toContent = (value: unknown) => (value === null || value === undefined ? "" : toText(value));
  const toInnerText = (value: unknown) => (value === null ? "" : toText(value));
  const script = win.HTMLScriptElement?.prototype;
  hook(node, "textContent", toContent);
  hook(win.HTMLElement?.prototype, "innerText", toInnerText);
  // Trusted Types gives script elements their own textContent and innerText, which shadow the two above.
  hook(script, "textContent", toContent);
  hook(script, "innerText", toInnerText);
  hook(script, "text", toText);

  return { isScript, write, read, check };
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
