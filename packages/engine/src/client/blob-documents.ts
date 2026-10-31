import { decodeText } from "../shared/charset.ts";
import { append, apply, hrefOf, NativeMap, parseUrl, protocolOf } from "../shared/primordials.ts";
import type { InheritedContext } from "../shared/protocol.ts";
import type { Invoke } from "./invoke.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { blobParts } from "./worker-bootstrap.ts";

export type BlobTreatment = "html" | "pdf" | "sandbox";

/** A blob document would run on our origin without the runtime, so navigations get a bootstrap that loads it first. */
export interface BlobDocuments {
  /** A bootstrap blob URL for a blob URL; anything else comes back unchanged. */
  swap(url: string): string;
  /** The blob URL the page gave for a bootstrap, so reads show the page its own URL. */
  original(url: string): string;
  /**
   * Swaps a followed link's blob href until the browser has read it. A context menu or drag reads it later, so
   * `sticky` keeps the swap until `restoreLinks`.
   */
  swapLink(link: unknown, sticky?: boolean): void;
  restoreLinks(): void;
  /** Swaps a blob form action and submitter override for the submission. */
  swapForm(form: unknown, submitter?: unknown): void;
  /** Shows the original blob in the bootstrap document, once the runtime is in place there. */
  load(blobUrl: string): Promise<void>;
}

export interface BlobLoadNatives {
  fetch: typeof fetch;
  /** The browser's own write: the HTML rewriter would give the viewer's sandbox allow-same-origin. */
  write: (this: Document, ...text: string[]) => void;
  invoke: Invoke;
}

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const LINK_ATTRIBUTES = ["href", "xlink:href"];
/** Link and form bootstraps go after this; a frame keeps its own for reloads and history steps. */
const LINK_BOOT_TTL = 60_000;

// Taken at load: swaps and loads run inside page calls, after page code may have replaced these.
const describe = Object.getOwnPropertyDescriptor;
const then = Promise.prototype.then;
const headersOf = describe(Response.prototype, "headers")?.get as (this: Response) => Headers;
const headerOf = Headers.prototype.get;
const bytesOf = Response.prototype.arrayBuffer;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const warn = console.warn;
const nativeConsole = console;

/** Lookup tables, so type parsing and escaping use only string indexing. */
const table = (pairs: string[][]): Record<string, string> => {
  const map = Object.create(null) as Record<string, string>;
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index] as string[];
    map[pair[0] as string] = pair[1] as string;
  }
  return map;
};
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = table(Array.from(UPPER, (char, index) => [char, "abcdefghijklmnopqrstuvwxyz"[index]!]));
const WHITESPACE = table([" ", "\t", "\n", "\r", "\f"].map((char) => [char, char]));
const ESCAPES = table([
  ["&", "&amp;"],
  ['"', "&quot;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ["'", "&#39;"],
]);

/** Parsed rather than matched, so "BLOB:" or " blob:" are blobs too; a relative URL never is. */
export function isBlobUrl(value: string): boolean {
  return parsedBlob(value) !== null;
}

/** Standards mode and a charset, then the runtime tag; the runtime writes the real document over it. */
export function blobBootstrapHtml(tag: string): string {
  return `<!doctype html><meta charset="utf-8">${tag}`;
}

export function blobTreatment(contentType: string | null): BlobTreatment {
  const essence = essenceOf(contentType ?? "");
  if (essence === "text/html") return "html";
  if (essence === "application/pdf") return "pdf";
  return "sandbox";
}

/** Shows a blob the runtime cannot rewrite in a frame without scripts or our origin. */
export function sandboxedViewerHtml(blobUrl: string): string {
  return (
    "<!doctype html><style>html,body{margin:0;height:100%}</style>" +
    `<iframe sandbox="" src="${escapeAttribute(blobUrl)}" style="border:0;width:100%;height:100%"></iframe>`
  );
}

/** ASCII-lowercased and trimmed through string indexing alone, for attribute values the page controls. */
export function lowerTrim(value: string | null): string {
  let out = "";
  let space = "";
  const text = value ?? "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (WHITESPACE[char]) {
      if (out) space += char;
      continue;
    }
    out += space + (LOWER[char] ?? char);
    space = "";
  }
  return out;
}

/**
 * Taken before the html sinks and network hooks, so the loader gets the browser's own fetch and write. Also hooks
 * `click()` and `dispatchEvent`, since a link outside the document never reaches the window's click listener.
 */
export function installBlobDocuments(
  win: Realm,
  ctx: UrlContext,
  tagFor: (inherit: InheritedContext) => string,
  invoke: Invoke,
): BlobDocuments {
  const Blob = win.Blob;
  const urls = win.URL;
  const createObjectURL = urls.createObjectURL;
  const revokeObjectURL = urls.revokeObjectURL;
  const { getAttribute, setAttribute, hasAttribute } = win.Element.prototype;
  const localNameOf = describe(win.Element.prototype, "localName")?.get;
  const namespaceOf = describe(win.Element.prototype, "namespaceURI")?.get;
  const typeOf = win.Event ? describe(win.Event.prototype, "type")?.get : undefined;
  const timer = win.setTimeout;
  const revoke = (url: string) => {
    try {
      if (revokeObjectURL) apply(revokeObjectURL, urls, [url]);
    } catch {
      // Already gone.
    }
  };
  const natives: BlobLoadNatives = { fetch: win.fetch, write: win.Document.prototype.write, invoke };
  const originals = new NativeMap<string, string>();
  let pending: Array<() => void> = [];

  const swap = (url: string): string => {
    const blob = parsedBlob(url);
    if (blob === null || apply(mapHas, originals, [blob])) return url;
    try {
      const inherit = { __proto__: null, origin: ctx.origin, base: hrefOf(ctx.realBase()), blob } as InheritedContext;
      const tag = tagFor(inherit);
      const options = { __proto__: null, type: "text/html" } as BlobPropertyBag;
      const boot = apply(createObjectURL, urls, [new Blob(blobParts(blobBootstrapHtml(tag)), options)]) as string;
      apply(mapSet, originals, [boot, url]);
      return boot;
    } catch {
      // Never the original, which would run without the runtime.
      return "about:blank";
    }
  };

  const original = (url: string): string => (apply(mapGet, originals, [url]) as string | undefined) ?? url;

  /** Swaps each named attribute that holds a blob URL; the returned function puts back what is still ours. */
  const swapAttributes = (element: unknown, names: string[]): (() => void) | null => {
    const undo: Array<() => void> = [];
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!;
      const value = apply(getAttribute, element, [name]) as string | null;
      const boot = value === null ? value : swap(value);
      if (boot === null || boot === value) continue;
      apply(setAttribute, element, [name, boot]);
      append(undo, () => {
        if (apply(getAttribute, element, [name]) === boot) apply(setAttribute, element, [name, value]);
        // The browser has followed the link, or never will, long before this.
        apply(timer, win, [() => revoke(boot), LINK_BOOT_TTL]);
      });
    }
    if (!undo.length) return null;
    return () => {
      for (let index = 0; index < undo.length; index++) undo[index]!();
    };
  };
  const later = (restore: (() => void) | null) => {
    // The browser reads the URL when dispatch ends, before any timer runs, so the page gets its own URL back.
    if (restore) apply(timer, win, [restore, 0]);
  };

  const swapLink = (link: unknown, sticky = false): void => {
    try {
      if (apply(hasAttribute, link, ["download"])) return;
      const restore = swapAttributes(link, LINK_ATTRIBUTES);
      if (!sticky) later(restore);
      else if (restore) append(pending, restore);
    } catch {
      // Not an element of this realm.
    }
  };
  const restoreLinks = (): void => {
    const restores = pending;
    pending = [];
    for (let index = 0; index < restores.length; index++) restores[index]!();
  };
  const swapForm = (form: unknown, submitter?: unknown): void => {
    try {
      later(swapAttributes(form, ["action"]));
      if (submitter) later(swapAttributes(submitter, ["formaction"]));
    } catch {
      // Not an element of this realm.
    }
  };

  /** HTML a and area, and SVG a: the elements whose activation follows a link. */
  const isLink = (target: unknown): boolean => {
    try {
      if (!localNameOf || !namespaceOf) return false;
      const name = apply(localNameOf, target, []) as string;
      const namespace = apply(namespaceOf, target, []) as string | null;
      return name === "a" ? namespace === HTML_NAMESPACE || namespace === SVG_NAMESPACE : name === "area";
    } catch {
      return false;
    }
  };
  const elementProto = win.HTMLElement?.prototype;
  const click = elementProto?.click as ((this: HTMLElement) => void) | undefined;
  if (elementProto && click) {
    elementProto.click = maskNative(function (this: HTMLElement) {
      if (isLink(this)) swapLink(this);
      return apply(click, this, []);
    }, click);
  }
  const targetProto = win.EventTarget?.prototype;
  const dispatch = targetProto?.dispatchEvent;
  if (targetProto && dispatch && typeOf) {
    targetProto.dispatchEvent = maskNative(function (this: EventTarget, event: Event) {
      try {
        const type = apply(typeOf, event, []);
        if ((type === "click" || type === "auxclick") && isLink(this)) swapLink(this);
      } catch {
        // Not an event; the native call reports it.
      }
      return apply(dispatch, this, [event]) as boolean;
    }, dispatch);
  }

  return {
    swap,
    original,
    swapLink,
    restoreLinks,
    swapForm,
    load: (blobUrl) => loadBlobDocument(win, blobUrl, natives),
  };
}

/**
 * The "blob document" step. HTML goes through the hooked document calls, so it is rewritten and runs under the
 * runtime; a PDF goes to the browser's viewer; anything else is shown sandboxed. The bootstrap stays alive with its
 * creator, since a reload or a history step loads it again.
 */
export function loadBlobDocument(win: Realm, blobUrl: string, natives: BlobLoadNatives): Promise<void> {
  const fail = (error: unknown) => {
    // The bootstrap document stays blank.
    apply(warn, nativeConsole, ["Girici: blob document", error]);
  };
  const show = (response: Response): unknown => {
    const type = apply(headerOf, apply(headersOf, response, []), ["content-type"]) as string | null;
    const treatment = blobTreatment(type);
    if (treatment === "pdf") {
      const location = win.location;
      natives.invoke(location.replace, location, [blobUrl]);
      return undefined;
    }
    if (treatment === "sandbox") {
      writeDocument(win, natives.write, sandboxedViewerHtml(blobUrl));
      return undefined;
    }
    const decoded = (bytes: ArrayBuffer) => writeDocument(win, null, decodeText(bytes, type));
    return apply(then, apply(bytesOf, response, []), [decoded, fail]);
  };
  // Through the captured then: a replaced one could hand back a response of its own, typed as a PDF.
  const shown = apply(then, apply(natives.fetch, win, [blobUrl]), [show, fail]);
  return apply(then, shown, [undefined, fail]) as Promise<void>;
}

/** `write` is null for the hooked one, which rewrites the markup. */
function writeDocument(win: Realm, write: BlobLoadNatives["write"] | null, markup: string): void {
  const proto = win.Document.prototype;
  const doc = win.document;
  apply(proto.open, doc, []);
  apply(write ?? proto.write, doc, [markup]);
  apply(proto.close, doc, []);
}

function parsedBlob(value: string): string | null {
  const url = parseUrl(value);
  return url && protocolOf(url) === "blob:" ? hrefOf(url) : null;
}

/** The type before its parameters, lowercased and trimmed; a list of types is none, as the browser renders the last. */
function essenceOf(type: string): string | null {
  for (let index = 0; index < type.length; index++) if (type[index] === ",") return null;
  let essence = "";
  for (let index = 0; index < type.length && type[index] !== ";"; index++) essence += type[index];
  return lowerTrim(essence);
}

function escapeAttribute(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index++) escaped += ESCAPES[value[index]!] ?? value[index];
  return escaped;
}
