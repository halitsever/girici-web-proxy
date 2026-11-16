import { define, endsWith, joined } from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { ScriptText } from "./script-text.ts";
import type { Realm } from "./url-context.ts";

// Taken at load, so a page that replaced them never receives a native or the markup on its way in.
const apply = Reflect.apply;
const toText = String;
const lowerCase = String.prototype.toLowerCase;
const ownDescriptor = Object.getOwnPropertyDescriptor;

type Method = (...args: unknown[]) => unknown;
type ForTarget = (target: unknown, html: string) => string;

/**
 * HTML a page writes into the DOM is rewritten so its URLs stay proxied, and read back as the real markup it wrote.
 * Markup can hold frames, so each write ends with `afterWrite`, which gives new child windows the runtime.
 * `reopened` restores what a document cleared by an implicit open lost. Markup written into a script element is its
 * code, so it goes to `scripts`.
 */
export function installHtmlSinks(
  win: Realm,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
  afterWrite: (target: unknown) => void,
  reopened: (doc: unknown) => void,
  scripts: Pick<ScriptText, "isScript" | "write" | "read">,
): void {
  const element = win.Element.prototype;
  const markup: ForTarget = (target, html) =>
    scripts.isScript(target) ? scripts.write(target, html) : rewriteHtml(html);
  const restore: ForTarget = (target, html) => (scripts.isScript(target) ? scripts.read(target, html) : unhtml(html));
  wrapHtmlProperty(element, "innerHTML", markup, restore, afterWrite);
  // outerHTML replaces the element itself, so its markup is parsed in the parent and is never script text.
  wrapHtmlProperty(
    element,
    "outerHTML",
    (_target, html) => rewriteHtml(html),
    (_target, html) => unhtml(html),
    afterWrite,
  );
  const shadowRoot = win.ShadowRoot?.prototype;
  if (shadowRoot) wrapHtmlProperty(shadowRoot, "innerHTML", markup, restore, afterWrite);
  // setHTML's sanitizer keeps links and image addresses, so its input is rewritten as well.
  const setters = ["setHTMLUnsafe", "setHTML"] as const;
  const roots = [element, shadowRoot];
  // Indexed: adopting a frame installs this inside a page call, after the page may have replaced the array iterator.
  for (let root = 0; root < roots.length; root++) {
    const proto = roots[root];
    if (!proto) continue;
    for (let index = 0; index < setters.length; index++) {
      wrapMethod(
        proto,
        setters[index] as string,
        (native) =>
          function (this: unknown, html: unknown, ...rest: unknown[]) {
            try {
              return apply(native, this, joined([markup(this, toText(html))], rest));
            } finally {
              afterWrite(this);
            }
          },
      );
    }
    wrapMethod(
      proto,
      "getHTML",
      (native) =>
        function (this: unknown, ...args: unknown[]) {
          return restore(this, toText(apply(native, this, args)));
        },
    );
  }
  const parsers = ["parseHTMLUnsafe", "parseHTML"] as const;
  for (let index = 0; index < parsers.length; index++) {
    wrapMethod(
      win.Document,
      parsers[index] as string,
      (native) =>
        function (this: unknown, html: unknown, ...rest: unknown[]) {
          return apply(native, this, joined([rewriteHtml(toText(html))], rest));
        },
    );
  }

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
  // Indexed: adopting a frame installs this inside a page call, after the page may have replaced the array iterator.
  const writeMethods = ["write", "writeln"] as const;
  for (let index = 0; index < writeMethods.length; index++) {
    const method = writeMethods[index] as (typeof writeMethods)[number];
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

/** Replaces `proto[name]` with what `wrap` makes of it, only where the browser has that method. */
function wrapMethod(proto: object, name: string, wrap: (native: Method) => Method): void {
  const descriptor = ownDescriptor(proto, name);
  const native = descriptor?.value as unknown;
  if (typeof native !== "function") return;
  define(proto, name, { ...descriptor, value: maskNative(wrap(native as Method), native) });
}

function wrapHtmlProperty(
  proto: object,
  name: string,
  rewriteHtml: ForTarget,
  unhtml: ForTarget,
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
          return unhtml(this, toText(apply(get, this, [])));
        }
      : undefined,
    set(this: unknown, value: unknown) {
      try {
        apply(set, this, [rewriteHtml(this, toText(value))]);
      } finally {
        afterWrite(this);
      }
    },
  });
}
