import type { Realm } from "./url-context.ts";

// Taken at load, so a page that replaced them never receives a native or the markup on its way in.
const apply = Reflect.apply;
const toText = String;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;

type Method = (...args: unknown[]) => unknown;

/**
 * HTML a page writes into the DOM is rewritten so its URLs stay proxied, and read back as the real markup it wrote.
 * Markup can hold frames, so each write ends with `afterWrite`, which gives new child windows the runtime.
 */
export function installHtmlSinks(
  win: Realm,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
  afterWrite: (target: unknown) => void,
): void {
  const element = win.Element.prototype;
  wrapHtmlProperty(element, "innerHTML", rewriteHtml, unhtml, afterWrite);
  wrapHtmlProperty(element, "outerHTML", rewriteHtml, unhtml, afterWrite);
  if (win.ShadowRoot) wrapHtmlProperty(win.ShadowRoot.prototype, "innerHTML", rewriteHtml, unhtml, afterWrite);

  const nativeInsert = element.insertAdjacentHTML as Method;
  element.insertAdjacentHTML = function (this: Element, position: InsertPosition, text: string) {
    try {
      apply(nativeInsert, this, [position, rewriteHtml(toText(text))]);
    } finally {
      afterWrite(this);
    }
  };

  const documentProto = win.Document.prototype;
  for (const method of ["write", "writeln"] as const) {
    const native = documentProto[method] as Method;
    documentProto[method] = function (this: Document, ...args: unknown[]) {
      let markup = "";
      for (let index = 0; index < args.length; index++) markup += toText(args[index]);
      try {
        apply(native, this, [rewriteHtml(markup)]);
      } finally {
        afterWrite(this);
      }
    };
  }

  const nativeParse = win.DOMParser.prototype.parseFromString as Method;
  win.DOMParser.prototype.parseFromString = function (this: DOMParser, source: string, type: DOMParserSupportedType) {
    // Only markup types run through the HTML rewriter; JSON and plain text are parsed as given.
    const markup = type === "text/html" || type === "image/svg+xml" || type.endsWith("+xml");
    try {
      return apply(nativeParse, this, [markup ? rewriteHtml(toText(source)) : source, type]) as Document;
    } finally {
      afterWrite(this);
    }
  };

  const nativeFragment = win.Range.prototype.createContextualFragment as Method;
  win.Range.prototype.createContextualFragment = function (this: Range, fragment: string) {
    try {
      return apply(nativeFragment, this, [rewriteHtml(toText(fragment))]) as DocumentFragment;
    } finally {
      afterWrite(this);
    }
  };
}

function wrapHtmlProperty(
  proto: object,
  name: string,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
  afterWrite: (target: unknown) => void,
): void {
  const descriptor = ownDescriptor(proto, name);
  if (!descriptor?.set) return;
  const { get, set } = descriptor;
  defineProperty(proto, name, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get: get
      ? function (this: unknown) {
          return unhtml(toText(apply(get, this, [])));
        }
      : undefined,
    set(this: unknown, value: unknown) {
      try {
        apply(set, this, [rewriteHtml(toText(value))]);
      } finally {
        afterWrite(this);
      }
    },
  });
}
