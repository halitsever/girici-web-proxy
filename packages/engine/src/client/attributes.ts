import { attributeKind, restoreAttribute, rewriteAttribute } from "./attribute-values.ts";
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
const LINK_ELEMENTS = ["HTMLAnchorElement", "HTMLAreaElement"];
const LINK_PARTS = ["protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const;
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Pages read and write real URLs while the DOM keeps the proxied ones the browser actually loads. */
export function installAttributes(win: Realm, ctx: UrlContext): void {
  for (const [name, property] of URL_PROPERTIES) {
    wrap(
      win,
      name,
      property,
      (value) => (value ? ctx.fromProxy(value) : value),
      (value) => ctx.toProxy(value),
    );
  }
  for (const [name, property] of SRCSET_PROPERTIES) {
    wrap(
      win,
      name,
      property,
      (value) => restoreAttribute("img", "srcset", value, ctx.realBase(), ctx.origin),
      (value) => rewriteAttribute("img", "srcset", value, ctx.realBase(), ctx.origin),
    );
  }
  for (const name of LINK_ELEMENTS) installLinkParts(win, name);

  const element = win.Element.prototype;
  const { setAttribute, getAttribute, setAttributeNS, getAttributeNS } = element;
  element.setAttribute = function (this: Element, name: string, value: string) {
    setAttribute.call(this, name, rewrite(this, name, String(value)));
  };
  element.getAttribute = function (this: Element, name: string) {
    const value = getAttribute.call(this, name);
    return value === null ? value : restore(this, name, value);
  };
  element.setAttributeNS = function (this: Element, namespace: string | null, name: string, value: string) {
    setAttributeNS.call(this, namespace, name, rewrite(this, attributeName(namespace, name), String(value)));
  };
  element.getAttributeNS = function (this: Element, namespace: string | null, name: string) {
    const value = getAttributeNS.call(this, namespace, name);
    return value === null ? value : restore(this, attributeName(namespace, name), value);
  };

  // Reading an Attr node directly (getAttributeNode, the attributes map, nodeValue, textContent) must show the real URL.
  for (const name of ["value", "nodeValue", "textContent"] as const) {
    const descriptor = findAccessor(win.Attr.prototype, name);
    if (!descriptor?.get || !descriptor.set) continue;
    const { get, set } = descriptor;
    Object.defineProperty(win.Attr.prototype, name, {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get(this: Attr) {
        const value = get.call(this);
        const owner = this.ownerElement;
        return owner && typeof value === "string" ? restore(owner, this.name, value) : value;
      },
      set(this: Attr, value: unknown) {
        const owner = this.ownerElement;
        set.call(this, owner ? rewrite(owner, this.name, String(value)) : String(value));
      },
    });
  }

  function rewrite(target: Element, name: string, value: string): string {
    return attributeKind(target.localName, name)
      ? rewriteAttribute(target.localName, name, value, ctx.realBase(), ctx.origin)
      : value;
  }

  function restore(target: Element, name: string, value: string): string {
    return attributeKind(target.localName, name)
      ? restoreAttribute(target.localName, name, value, ctx.realBase(), ctx.origin)
      : value;
  }
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
  Object.defineProperty(proto, property, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get(this: unknown) {
      return read(String(get.call(this)));
    },
    set: set
      ? function (this: unknown, value: unknown) {
          set.call(this, write(String(value)));
        }
      : undefined,
  });
}

/** Link parts such as hostname come from the real href, so pages can tell internal links from external ones. */
function installLinkParts(win: Realm, constructorName: string): void {
  const proto = prototypeOf(win, constructorName);
  if (!proto) return;
  // A link without a parsable href reports empty parts, as browsers do.
  const realUrl = (link: object): URL | null => {
    try {
      return new URL(String((link as { href: string }).href));
    } catch {
      return null;
    }
  };
  Object.defineProperty(proto, "origin", {
    configurable: true,
    enumerable: true,
    get(this: object) {
      return realUrl(this)?.origin ?? "";
    },
  });
  for (const part of LINK_PARTS) {
    Object.defineProperty(proto, part, {
      configurable: true,
      enumerable: true,
      get(this: object) {
        return realUrl(this)?.[part] ?? "";
      },
      set(this: object, value: unknown) {
        const next = realUrl(this);
        if (!next) return;
        next[part] = String(value);
        (this as { href: string }).href = next.href;
      },
    });
  }
  Object.defineProperty(proto, "toString", {
    configurable: true,
    writable: true,
    value(this: object) {
      return String((this as { href: string }).href);
    },
  });
}

function prototypeOf(win: Realm, constructorName: string): object | undefined {
  return (win as unknown as Record<string, { prototype?: object } | undefined>)[constructorName]?.prototype;
}

function attributeName(namespace: string | null, name: string): string {
  const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
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
