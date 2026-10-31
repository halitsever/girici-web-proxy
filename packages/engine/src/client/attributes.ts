import {
  apply,
  define,
  hrefOf,
  indexOf,
  NativeWeakMap,
  originOf,
  parseUrl,
  setUrlPart,
  setHas,
  sliceOf,
  toText,
  urlPart,
} from "../shared/primordials.ts";
import { mapRefresh, rewriteRefresh } from "../rewrite/refresh.ts";
import { attributeKind, restoreAttribute, rewriteAttribute } from "./attribute-values.ts";
import { lowerTrim, type BlobDocuments } from "./blob-documents.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm, UrlContext } from "./url-context.ts";

const URL_PROPERTIES: Array<[string, string]> = [
  ["HTMLAnchorElement", "href"],
  ["HTMLAreaElement", "href"],
  ["HTMLLinkElement", "href"],
  ["HTMLBaseElement", "href"],
  ["HTMLFormElement", "action"],
  ["HTMLButtonElement", "formAction"],
  ["HTMLInputElement", "formAction"],
  ["HTMLImageElement", "src"],
  ["HTMLImageElement", "currentSrc"],
  ["HTMLScriptElement", "src"],
  ["HTMLIFrameElement", "src"],
  ["HTMLFrameElement", "src"],
  ["HTMLEmbedElement", "src"],
  ["HTMLSourceElement", "src"],
  ["HTMLTrackElement", "src"],
  ["HTMLInputElement", "src"],
  ["HTMLMediaElement", "src"],
  ["HTMLMediaElement", "currentSrc"],
  ["HTMLVideoElement", "poster"],
  ["HTMLObjectElement", "data"],
];
const SRCSET_PROPERTIES: Array<[string, string]> = [
  ["HTMLImageElement", "srcset"],
  ["HTMLSourceElement", "srcset"],
];
const INTEGRITY_PROPERTIES: Array<[string, string]> = [
  ["HTMLScriptElement", "integrity"],
  ["HTMLLinkElement", "integrity"],
];
/** Sinks that load a document into a frame, where a blob URL must become a bootstrap blob. */
const DOCUMENT_PROPERTIES = new Set([
  "HTMLIFrameElement.src",
  "HTMLFrameElement.src",
  "HTMLObjectElement.data",
  "HTMLEmbedElement.src",
]);
const DOCUMENT_ATTRIBUTES = new Set(["iframe.src", "frame.src", "object.data", "embed.src"]);
const LINK_ELEMENTS = ["HTMLAnchorElement", "HTMLAreaElement"];
const LINK_PARTS = ["protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const;
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

// Taken at load: the Attr hooks run inside page calls, after page code may have replaced these.
const ownDescriptor = Object.getOwnPropertyDescriptor;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;
const RUNTIME_ATTRIBUTE = "data-girici=";

/** What the page wrote for a srcdoc and the value that went into the DOM for it. */
interface SrcdocRecord {
  native: string;
  original: string;
}

/** The markup rewriters for a srcdoc document, which also carries the runtime tag. */
export interface SrcdocBridge {
  srcdoc(markup: string): string;
  unsrcdoc(markup: string): string;
}

export interface AttributeHooks {
  /** Rewrites the document-loading values of `node` and its descendants that the hooks never saw being written. */
  normalize(node: unknown): void;
}

/** Elements whose values load a document or navigate, and those values. */
const LOADING: Record<string, readonly string[]> = Object.assign(Object.create(null) as Record<string, string[]>, {
  iframe: ["src", "srcdoc"],
  frame: ["src"],
  object: ["data"],
  embed: ["src"],
  meta: ["content"],
});
const LOADING_SELECTOR = "iframe,frame,object,embed,meta";

/** Pages read and write real URLs while the DOM keeps the proxied ones the browser actually loads. */
export function installAttributes(
  win: Realm,
  ctx: UrlContext,
  markup: SrcdocBridge,
  blobs: Pick<BlobDocuments, "swap" | "original">,
): AttributeHooks {
  const written = new NativeWeakMap<object, SrcdocRecord>();
  const carried = new NativeWeakMap<object, SrcdocRecord>();
  const original = (node: object, value: string): string => {
    const record = apply(mapGet, carried, [node]) as SrcdocRecord | undefined;
    return record && record.native === value ? record.original : value;
  };
  // Every loop here is indexed, without destructuring: adopting a frame installs these inside a page call, after the
  // page may have replaced the array iterator.
  for (let index = 0; index < URL_PROPERTIES.length; index++) {
    const entry = URL_PROPERTIES[index] as [string, string];
    const name = entry[0];
    const property = entry[1];
    const opens = setHas(DOCUMENT_PROPERTIES, `${name}.${property}`);
    wrap(
      win,
      name,
      property,
      (value) => (value ? ctx.fromProxy(blobs.original(value)) : value),
      (value) => (opens ? blobs.swap(ctx.toProxy(value)) : ctx.toProxy(value)),
    );
  }
  for (let index = 0; index < SRCSET_PROPERTIES.length; index++) {
    const entry = SRCSET_PROPERTIES[index] as [string, string];
    wrap(
      win,
      entry[0],
      entry[1],
      (value) => restoreAttribute("img", "srcset", value, ctx.realBase(), ctx.origin),
      (value) => rewriteAttribute("img", "srcset", value, ctx.realBase(), ctx.origin),
    );
  }
  for (let index = 0; index < INTEGRITY_PROPERTIES.length; index++) {
    const entry = INTEGRITY_PROPERTIES[index] as [string, string];
    const property = entry[1];
    wrap(
      win,
      entry[0],
      property,
      (value) => value,
      (value) => rewriteAttribute("script", property, value, ctx.realBase(), ctx.origin),
    );
  }
  installSrcdoc();
  for (let index = 0; index < LINK_ELEMENTS.length; index++) installLinkParts(win, LINK_ELEMENTS[index] as string);

  const element = win.Element.prototype;
  const { setAttribute, getAttribute, setAttributeNS, getAttributeNS } = element;
  const localNameOf = ownDescriptor(element, "localName")?.get;
  const tagOf = (target: unknown): string =>
    localNameOf ? (apply(localNameOf, target, []) as string) : (target as Element).localName;
  element.setAttribute = function (this: Element, name: string, value: string) {
    apply(setAttribute, this, [name, rewrite(this, name, toText(value))]);
    settle(this);
  };
  element.getAttribute = function (this: Element, name: string) {
    const value = apply(getAttribute, this, [name]);
    return value === null ? value : restore(this, name, value);
  };
  element.setAttributeNS = function (this: Element, namespace: string | null, name: string, value: string) {
    apply(setAttributeNS, this, [namespace, name, rewrite(this, attributeName(namespace, name), toText(value))]);
    settle(this);
  };
  element.getAttributeNS = function (this: Element, namespace: string | null, name: string) {
    const value = apply(getAttributeNS, this, [namespace, name]);
    return value === null ? value : restore(this, attributeName(namespace, name), value);
  };

  // Taken here: a page that changed these accessors could make a frame's value skip the rewrite.
  const attrNameGet = ownDescriptor(win.Attr.prototype, "name")?.get;
  const attrOwnerGet = ownDescriptor(win.Attr.prototype, "ownerElement")?.get;
  const attrNamespaceOf = ownDescriptor(win.Attr.prototype, "namespaceURI")?.get;
  const attrNameOf = (node: unknown): string =>
    attrNameGet ? (apply(attrNameGet, node, []) as string) : (node as Attr).name;
  const ownerOf = (node: unknown): Element | null =>
    attrOwnerGet ? (apply(attrOwnerGet, node, []) as Element | null) : (node as Attr).ownerElement;

  // Reading an Attr node directly (getAttributeNode, the attributes map, nodeValue, textContent) must show the real URL.
  const nativeValue = findAccessor(win.Attr.prototype, "value");
  const attrProperties = ["value", "nodeValue", "textContent"] as const;
  for (let index = 0; index < attrProperties.length; index++) {
    const name = attrProperties[index] as (typeof attrProperties)[number];
    const descriptor = findAccessor(win.Attr.prototype, name);
    if (!descriptor?.get || !descriptor.set) continue;
    const { get, set } = descriptor;
    define(win.Attr.prototype, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get(this: Attr) {
        const value: unknown = apply(get, this, []);
        const owner = ownerOf(this);
        if (typeof value !== "string") return value;
        return owner ? restore(owner, attrNameOf(this), value) : original(this, value);
      },
      set(this: Attr, value: unknown) {
        const owner = ownerOf(this);
        apply(set, this, [owner ? rewrite(owner, attrNameOf(this), toText(value)) : toText(value)]);
        if (owner) settle(owner);
      },
    });
  }

  // A node attached whole skips the value setters above, so its value is rewritten before it goes in.
  const attrValue = nativeValue?.get && nativeValue.set ? { get: nativeValue.get, set: nativeValue.set } : null;
  const prepare = (target: unknown, node: unknown): void => {
    if (!attrValue || typeof node !== "object" || node === null) return;
    try {
      const value = apply(attrValue.get, node, []);
      if (typeof value !== "string") return;
      const namespaceURI = attrNamespaceOf ? (apply(attrNamespaceOf, node, []) as string | null) : null;
      const name = attrNameOf(node);
      const known = apply(mapGet, carried, [node]) as SrcdocRecord | undefined;
      if (known && known.native === value) {
        // Its own earlier output: rewriting it again would only lose the page's string.
        apply(mapSet, written, [target, known]);
        return;
      }
      const next = rewrite(target as Element, attributeName(namespaceURI, name), value);
      if (next !== value) apply(attrValue.set, node, [next]);
      const record = apply(mapGet, written, [target]) as SrcdocRecord | undefined;
      if (record && record.native === next) apply(mapSet, carried, [node, record]);
    } catch {
      // The native call reports a node that is not an Attr.
    }
  };
  const nodeSetters = ["setAttributeNode", "setAttributeNodeNS"] as const;
  for (let index = 0; index < nodeSetters.length; index++) {
    const name = nodeSetters[index] as (typeof nodeSetters)[number];
    const native = element[name] as (...args: unknown[]) => unknown;
    element[name] = maskNative(function (this: Element, node: Attr) {
      prepare(this, node);
      try {
        return apply(native, this, [node]);
      } finally {
        settle(this);
      }
    }, native) as typeof element.setAttributeNode;
  }

  // A NamedNodeMap does not name its element, so the attributes getter records it.
  const owners = new NativeWeakMap<object, Element>();
  const attributes = ownDescriptor(element, "attributes");
  if (attributes?.get) {
    const read = attributes.get;
    define(element, "attributes", {
      configurable: true,
      enumerable: attributes.enumerable ?? true,
      get: maskNative(function (this: Element) {
        const map = apply(read, this, []) as object;
        apply(mapSet, owners, [map, this]);
        return map;
      }, read),
    });
  }
  const mapProto = win.NamedNodeMap?.prototype;
  if (mapProto) {
    const mapSetters = ["setNamedItem", "setNamedItemNS"] as const;
    for (let index = 0; index < mapSetters.length; index++) {
      const name = mapSetters[index] as (typeof mapSetters)[number];
      const native = mapProto[name] as (...args: unknown[]) => unknown;
      mapProto[name] = maskNative(function (this: NamedNodeMap, node: Attr) {
        const owner = apply(mapGet, owners, [this]);
        if (owner) prepare(owner, node);
        try {
          return apply(native, this, [node]);
        } finally {
          if (owner) settle(owner);
        }
      }, native) as typeof mapProto.setNamedItem;
    }
  }

  // The page's own srcdoc string per element, good while the attribute still holds what was written for it.
  function installSrcdoc(): void {
    const proto = prototypeOf(win, "HTMLIFrameElement");
    const descriptor = proto && ownDescriptor(proto, "srcdoc");
    if (!proto || !descriptor?.get) return;
    const { get, set } = descriptor;
    define(proto, "srcdoc", {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get: maskNative(function (this: Element) {
        return restore(this, "srcdoc", apply(get, this, []) as string);
      }, get),
      set: set
        ? maskNative(function (this: Element, value: unknown) {
            apply(set, this, [rewrite(this, "srcdoc", `${value}`)]);
          }, set)
        : undefined,
    });
  }

  // The browser reads a refresh when the meta goes in, so its content is kept rewritten whichever was set first.
  const metaProto = win.HTMLMetaElement?.prototype;
  const metaProperties = [
    ["content", "content"],
    ["httpEquiv", "http-equiv"],
  ] as const;
  for (let index = 0; index < metaProperties.length; index++) {
    const property = (metaProperties[index] as (typeof metaProperties)[number])[0];
    const attribute = (metaProperties[index] as (typeof metaProperties)[number])[1];
    const descriptor = metaProto && ownDescriptor(metaProto, property);
    if (!metaProto || !descriptor?.set) continue;
    const hookedGet = element.getAttribute;
    const hookedSet = element.setAttribute;
    define(metaProto, property, {
      ...descriptor,
      get(this: Element) {
        return (apply(hookedGet, this, [attribute]) as string | null) ?? "";
      },
      set(this: Element, value: unknown) {
        apply(hookedSet, this, [attribute, toText(value)]);
      },
    });
  }

  const nodeListLength = win.NodeList ? ownDescriptor(win.NodeList.prototype, "length")?.get : undefined;
  const queries = [
    element.querySelectorAll,
    win.DocumentFragment?.prototype.querySelectorAll,
    win.Document?.prototype.querySelectorAll,
  ];
  const normalizeOne = (target: unknown): void => {
    try {
      const tag: unknown = localNameOf ? apply(localNameOf, target, []) : undefined;
      const names = typeof tag === "string" ? LOADING[tag] : undefined;
      if (!names) return;
      for (let index = 0; index < names.length; index++) {
        const name = names[index] as string;
        const value = apply(getAttribute, target, [name]) as string | null;
        if (value === null || (name === "content" && !isRefresh(target as Element))) continue;
        if (name === "srcdoc") {
          const record = apply(mapGet, written, [target]) as SrcdocRecord | undefined;
          if (record && record.native === value) continue;
        } else if (blobs.original(value) !== value) continue;
        const next = rewrite(target as Element, name, restore(target as Element, name, value));
        if (next !== value) apply(setAttribute, target, [name, next]);
      }
    } catch {
      // Not an element of this realm.
    }
  };
  const normalize = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    normalizeOne(node);
    for (let index = 0; index < queries.length; index++) {
      const query = queries[index];
      if (!query || !nodeListLength) continue;
      try {
        const found = apply(query, node, [LOADING_SELECTOR]) as NodeListOf<Element>;
        const length = apply(nodeListLength, found, []) as number;
        for (let item = 0; item < length; item++) normalizeOne(found[item]);
        return;
      } catch {
        // The query of another node type.
      }
    }
  };

  /** The page's real origin, which its javascript: URLs carry. */
  function owner(): string {
    return originOf(ctx.realUrl());
  }

  function isRefresh(target: Element): boolean {
    return (
      tagOf(target) === "meta" && lowerTrim(apply(getAttribute, target, ["http-equiv"]) as string | null) === "refresh"
    );
  }

  function settle(target: Element): void {
    try {
      if (!isRefresh(target)) return;
      const content = apply(getAttribute, target, ["content"]) as string | null;
      const next = content === null ? null : rewriteRefresh(content, ctx.realBase(), ctx.origin);
      if (next !== content) apply(setAttribute, target, ["content", next]);
    } catch {
      // Not an element of this realm.
    }
  }

  function rewrite(target: Element, name: string, value: string): string {
    const attribute = lowerTrim(name);
    if (attribute === "content" && isRefresh(target)) {
      return rewriteRefresh(value, ctx.realBase(), ctx.origin);
    }
    const kind = attributeKind(tagOf(target), name);
    if (kind === "html") {
      const next = markup.srcdoc(value);
      // A value that already carries the runtime tag was rewritten before; its plain form is the best original left.
      const original = indexOf(value, RUNTIME_ATTRIBUTE) < 0 ? value : markup.unsrcdoc(value);
      apply(mapSet, written, [target, { native: next, original }]);
      return next;
    }
    if (!kind) return value;
    const rewritten = rewriteAttribute(tagOf(target), name, value, ctx.realBase(), ctx.origin, undefined, owner());
    return setHas(DOCUMENT_ATTRIBUTES, `${tagOf(target)}.${attribute}`) ? blobs.swap(rewritten) : rewritten;
  }

  function restore(target: Element, name: string, value: string): string {
    const base = ctx.realBase();
    if (lowerTrim(name) === "content" && isRefresh(target)) {
      return mapRefresh(value, (url) => blobs.original(restoreAttribute("a", "href", url, base, ctx.origin)));
    }
    const kind = attributeKind(tagOf(target), name);
    if (kind === "html") {
      const record = apply(mapGet, written, [target]) as SrcdocRecord | undefined;
      if (record && record.native === value) return record.original;
    }
    return kind
      ? blobs.original(restoreAttribute(tagOf(target), name, value, base, ctx.origin, markup.unsrcdoc))
      : value;
  }

  return { normalize };
}

function wrap(
  win: Realm,
  constructorName: string,
  property: string,
  read: (value: string) => string,
  write: (value: string) => string,
): void {
  const proto = prototypeOf(win, constructorName);
  const descriptor = proto && Object.getOwnPropertyDescriptor(proto, property);
  if (!proto || !descriptor?.get) return;
  const { get, set } = descriptor;
  define(proto, property, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get(this: unknown) {
      return read(toText(apply(get, this, [])));
    },
    set: set
      ? function (this: unknown, value: unknown) {
          apply(set, this, [write(toText(value))]);
        }
      : undefined,
  });
}

/** Link parts such as hostname come from the real href, so pages can tell internal links from external ones. */
function installLinkParts(win: Realm, constructorName: string): void {
  const proto = prototypeOf(win, constructorName);
  if (!proto) return;
  // A link without a parsable href reports empty parts, as browsers do.
  const realUrl = (link: object): URL | null => parseUrl(toText((link as { href: string }).href));
  define(proto, "origin", {
    configurable: true,
    enumerable: true,
    get(this: object) {
      const url = realUrl(this);
      return url ? urlPart(url, "origin") : "";
    },
  });
  for (let index = 0; index < LINK_PARTS.length; index++) {
    const part = LINK_PARTS[index] as (typeof LINK_PARTS)[number];
    define(proto, part, {
      configurable: true,
      enumerable: true,
      get(this: object) {
        const url = realUrl(this);
        return url ? urlPart(url, part) : "";
      },
      set(this: object, value: unknown) {
        const next = realUrl(this);
        if (!next) return;
        setUrlPart(next, part, toText(value));
        (this as { href: string }).href = hrefOf(next);
      },
    });
  }
  define(proto, "toString", {
    configurable: true,
    writable: true,
    value(this: object) {
      return toText((this as { href: string }).href);
    },
  });
}

function prototypeOf(win: Realm, constructorName: string): object | undefined {
  return (win as unknown as Record<string, { prototype?: object } | undefined>)[constructorName]?.prototype;
}

function attributeName(namespace: string | null, name: string): string {
  const colon = indexOf(name, ":");
  const local = colon >= 0 ? sliceOf(name, colon + 1) : name;
  return namespace === XLINK_NAMESPACE ? `xlink:${local}` : name;
}

/** Finds a property's accessor on an object or anywhere up its prototype chain (value is own, nodeValue is on Node). */
function findAccessor(start: object, name: string): PropertyDescriptor | undefined {
  for (let current: object | null = start; current; current = Object.getPrototypeOf(current) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return descriptor;
  }
  return undefined;
}
