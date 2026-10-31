import { decodeText } from "../shared/charset.ts";
import type { InheritedContext } from "../shared/protocol.ts";
import type { Invoke } from "./invoke.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { blobParts } from "./worker-bootstrap.ts";

export type BlobTreatment = "html" | "pdf" | "sandbox";

/** A blob document would run on our origin without the runtime, so navigations get a bootstrap that loads it first. */
export interface BlobDocuments {
  /** A bootstrap blob URL for a blob URL; anything else comes back unchanged. */
  swap(url: string): string;
  /** Swaps a followed link's blob href until the browser has read it. */
  swapLink(link: unknown): void;
  /** Shows the original blob in the bootstrap document, once the runtime is in place there. */
  load(blobUrl: string): Promise<void>;
}

export interface BlobLoadNatives {
  fetch: typeof fetch;
  /** The browser's own write: the HTML rewriter would give the viewer's sandbox allow-same-origin. */
  write: (this: Document, ...text: string[]) => void;
  invoke: Invoke;
}

// Taken at load: swaps and loads run inside page calls, after page code may have replaced these.
const apply = Reflect.apply;
const describe = Object.getOwnPropertyDescriptor;
const NativeURL = URL;
const protocolOf = describe(URL.prototype, "protocol")?.get as (this: URL) => string;
const hrefOf = describe(URL.prototype, "href")?.get as (this: URL) => string;
const then = Promise.prototype.then;
const headersOf = describe(Response.prototype, "headers")?.get as (this: Response) => Headers;
const headerOf = Headers.prototype.get;
const bytesOf = Response.prototype.arrayBuffer;
const setHas = Set.prototype.has;
const setAdd = Set.prototype.add;
const warn = console.warn;
const nativeConsole = console;

/** Lookup tables, so type parsing and escaping use only string indexing. */
const table = (pairs: string[][]): Record<string, string> => {
  const map = Object.create(null) as Record<string, string>;
  for (const [key, value] of pairs) map[key!] = value!;
  return map;
};
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = table(Array.from(UPPER, (char, index) => [char, "abcdefghijklmnopqrstuvwxyz"[index]!]));
const WHITESPACE = table([" ", "\t", "\n", "\r"].map((char) => [char, char]));
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

/** Taken before the html sinks and network hooks, so the loader gets the browser's own fetch and write. */
export function installBlobDocuments(
  win: Realm,
  ctx: UrlContext,
  tagFor: (inherit: InheritedContext) => string,
  invoke: Invoke,
): BlobDocuments {
  const Blob = win.Blob;
  const urls = win.URL;
  const createObjectURL = urls.createObjectURL;
  const { getAttribute, setAttribute, hasAttribute } = win.Element.prototype;
  const timer = win.setTimeout;
  const natives: BlobLoadNatives = { fetch: win.fetch, write: win.Document.prototype.write, invoke };
  const made = new Set<string>();

  const swap = (url: string): string => {
    const blob = parsedBlob(url);
    if (blob === null || apply(setHas, made, [blob])) return url;
    try {
      const tag = tagFor({ origin: ctx.origin, base: apply(hrefOf, ctx.realBase(), []), blob });
      const options = { __proto__: null, type: "text/html" } as BlobPropertyBag;
      const boot = apply(createObjectURL, urls, [new Blob(blobParts(blobBootstrapHtml(tag)), options)]) as string;
      apply(setAdd, made, [boot]);
      return boot;
    } catch {
      // Never the original, which would run without the runtime.
      return "about:blank";
    }
  };

  const swapLink = (link: unknown): void => {
    try {
      if (apply(hasAttribute, link, ["download"])) return;
      const href = apply(getAttribute, link, ["href"]) as string | null;
      const boot = href === null ? null : swap(href);
      if (boot === null || boot === href) return;
      apply(setAttribute, link, ["href", boot]);
      // The browser reads the href when dispatch ends, before any timer runs, so the page gets its own URL back.
      apply(timer, win, [
        () => {
          if (apply(getAttribute, link, ["href"]) === boot) apply(setAttribute, link, ["href", href]);
        },
        0,
      ]);
    } catch {
      // Not an element of this realm.
    }
  };

  return { swap, swapLink, load: (blobUrl) => loadBlobDocument(win, blobUrl, natives) };
}

/**
 * The "blob document" step. HTML goes through the hooked document calls, so it is rewritten and runs under the
 * runtime; a PDF goes to the browser's viewer; anything else is shown sandboxed.
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
  try {
    const url = new NativeURL(value);
    return apply(protocolOf, url, []) === "blob:" ? apply(hrefOf, url, []) : null;
  } catch {
    return null;
  }
}

/** The type before its parameters, lowercased and trimmed; a list of types is none, as the browser renders the last. */
function essenceOf(type: string): string | null {
  for (let index = 0; index < type.length; index++) if (type[index] === ",") return null;
  let essence = "";
  let space = "";
  for (let index = 0; index < type.length; index++) {
    const char = type[index]!;
    if (char === ";") break;
    if (WHITESPACE[char]) {
      if (essence) space += char;
      continue;
    }
    essence += space + (LOWER[char] ?? char);
    space = "";
  }
  return essence;
}

function escapeAttribute(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index++) escaped += ESCAPES[value[index]!] ?? value[index];
  return escaped;
}
