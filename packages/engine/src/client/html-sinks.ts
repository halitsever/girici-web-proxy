import type { Realm } from "./url-context.ts";

/** HTML a page writes into the DOM is rewritten so its URLs stay proxied, and read back as the real markup it wrote. */
export function installHtmlSinks(
  win: Realm,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
): void {
  const element = win.Element.prototype;
  wrapHtmlProperty(element, "innerHTML", rewriteHtml, unhtml);
  wrapHtmlProperty(element, "outerHTML", rewriteHtml, unhtml);
  if (win.ShadowRoot) wrapHtmlProperty(win.ShadowRoot.prototype, "innerHTML", rewriteHtml, unhtml);

  const nativeInsert = element.insertAdjacentHTML;
  element.insertAdjacentHTML = function (this: Element, position: InsertPosition, text: string) {
    nativeInsert.call(this, position, rewriteHtml(String(text)));
  };

  const documentProto = win.Document.prototype;
  for (const method of ["write", "writeln"] as const) {
    const native = documentProto[method];
    documentProto[method] = function (this: Document, ...args: string[]) {
      native.call(this, rewriteHtml(args.map(String).join("")));
    };
  }

  const nativeParse = win.DOMParser.prototype.parseFromString;
  win.DOMParser.prototype.parseFromString = function (this: DOMParser, source: string, type: DOMParserSupportedType) {
    // Only markup types run through the HTML rewriter; JSON and plain text are parsed as given.
    const markup = type === "text/html" || type === "image/svg+xml" || type.endsWith("+xml");
    return nativeParse.call(this, markup ? rewriteHtml(String(source)) : source, type);
  };

  const nativeFragment = win.Range.prototype.createContextualFragment;
  win.Range.prototype.createContextualFragment = function (this: Range, fragment: string) {
    return nativeFragment.call(this, rewriteHtml(String(fragment)));
  };
}

function wrapHtmlProperty(
  proto: object,
  name: string,
  rewriteHtml: (html: string) => string,
  unhtml: (html: string) => string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name);
  if (!descriptor?.set) return;
  const { get, set } = descriptor;
  Object.defineProperty(proto, name, {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get: get
      ? function (this: unknown) {
          return unhtml(String(get.call(this)));
        }
      : undefined,
    set(this: unknown, value: unknown) {
      set.call(this, rewriteHtml(String(value)));
    },
  });
}
