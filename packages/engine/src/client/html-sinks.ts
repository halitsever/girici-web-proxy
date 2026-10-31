import { define, endsWith } from "../shared/primordials.ts";
import type { Realm } from "./url-context.ts";

// Taken at load, so a page that replaced them never receives a native or the markup on its way in.
const apply = Reflect.apply;
const toText = String;
const lowerCase = String.prototype.toLowerCase;
const ownDescriptor = Object.getOwnPropertyDescriptor;

type Method = (...args: unknown[]) => unknown;

/**
 * HTML a page writes into the DOM is rewritten so its URLs stay proxied, and read back as the real markup it wrote.
 * Markup can hold frames, so each write ends with `afterWrite`, which gives new child windows the runtime.
 * `reopened` restores what a document cleared by an implicit open lost.
 */
export function installHtmlSinks(
  win: Realm,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
  afterWrite: (target: unknown) => void,
  reopened: (doc: unknown) => void,
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
  const readyState = ownDescriptor(documentProto, "readyState")?.get;
  const stateOf = (doc: unknown) => (readyState ? apply(readyState, doc, []) : "loading");
  for (const method of ["write", "writeln"] as const) {
    const native = documentProto[method] as Method;
    documentProto[method] = function (this: Document, ...args: unknown[]) {
      let markup = "";
      for (let index = 0; index < args.length; index++) markup += toText(args[index]);
      const before = stateOf(this);
      try {
        apply(native, this, [rewriteHtml(markup)]);
      } finally {
        // A write to a loaded document opens it first, unless the browser ignored the write: only a state that went
        // back to loading tells the two apart.
        if (before !== "loading" && stateOf(this) === "loading") reopened(this);
        afterWrite(this);
      }
    };
  }

  const nativeCommand = documentProto.execCommand as Method;
  documentProto.execCommand = function (this: Document, command: string, showUi?: boolean, value?: string) {
    const html = apply(lowerCase, toText(command), []) === "inserthtml" && value !== undefined;
    try {
      return apply(nativeCommand, this, [command, showUi, html ? rewriteHtml(toText(value)) : value]) as boolean;
    } finally {
      afterWrite(this);
    }
  };

  const nativeParse = win.DOMParser.prototype.parseFromString as Method;
  win.DOMParser.prototype.parseFromString = function (this: DOMParser, source: string, type: unknown) {
    // Converted once, so the native call sees the type that was checked. text/xml and application/xml stay as
    // written; their nodes meet the insertion backstop instead.
    const text = toText(type);
    const markup = text === "text/html" || text === "image/svg+xml" || endsWith(text, "+xml");
    try {
      return apply(nativeParse, this, [markup ? rewriteHtml(toText(source)) : source, text]) as Document;
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
  define(proto, name, {
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
