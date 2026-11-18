import { Parser } from "htmlparser2";
import MagicString from "magic-string";
import { isWebUrl, lowerCase, originOf, setHas, trim } from "../shared/primordials.ts";
import { isBlobUrl, rewriteJavascriptUrl, rewriteSrcset, rewriteUrl } from "../shared/url-rewrite.ts";
import { rewriteCss } from "./css.ts";
import { rewriteJs } from "./js.ts";
import { rewriteRefresh } from "./refresh.ts";
import {
  decodeCharacterData,
  decodeReferences,
  escapeCharacterData,
  escapeXmlAttribute,
  pseudoAttributes,
  scanProlog,
  type XmlInstruction,
} from "./xml.ts";

export interface HtmlRewriteOptions {
  url: URL;
  origin: string;
  inject?: string;
  scripts?: boolean;
  /** Runtime tag for a srcdoc document, which has no address of its own to load the runtime through. */
  frameInject?: (base: URL) => string;
  /** The runtime's blob swap for URLs that load a document, so a blob page starts with the runtime in place. */
  swapBlob?: (url: string) => string;
  /** The document's real origin, which its javascript: URLs carry; a `<base>` does not change it. */
  owner?: string;
  /** The document has a sealed address, so relative URLs are written absolute; a srcdoc inside inherits it. */
  opaque?: boolean;
  /** Has the last word on each attribute value, after the rewriter's own change. */
  attribute?: (tag: string, attribs: Record<string, string>, name: string, value: string) => string;
  /** An XHTML or SVG document: parsed as XML, and every edit keeps it well-formed. */
  xml?: boolean;
}

interface Attribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

type ScriptKind = "classic" | "module" | "importmap" | "none";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "xlink:href"]);
const DOCUMENT_URLS = new Set(["iframe src", "frame src", "embed src", "object data"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
/** SVG presentation attributes that take a url() reference. */
const PAINT_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
]);
const DROPPED_ATTRIBUTES = new Set(["integrity", "nonce", "ping"]);
const FETCHED_LINK_RELS = new Set([
  "stylesheet",
  "preload",
  "modulepreload",
  "prefetch",
  "icon",
  "apple-touch-icon",
  "apple-touch-icon-precomposed",
  "mask-icon",
  "manifest",
]);
// These make the browser contact the real site directly.
const DROPPED_LINK_RELS = new Set(["preconnect", "dns-prefetch", "prerender"]);
const DROPPED_META = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "set-cookie",
  "origin-trial",
]);
const JS_TYPE = /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?|text\/(?:jscript|livescript))$/i;

/** Edits attribute and inline code ranges in place; the document is never re-serialised, so markup quirks survive. */
export function rewriteHtml(html: string, options: HtmlRewriteOptions): string {
  const rewriter = new HtmlRewriter(options, false);
  rewriter.write(html);
  return rewriter.end() ?? html;
}

/** Null when the document has no root element to put the runtime in, so it cannot be served with scripts on. */
export function rewriteXml(xml: string, options: Omit<HtmlRewriteOptions, "xml">): string | null {
  const rewriter = new HtmlRewriter({ ...options, xml: true }, false);
  rewriter.write(xml);
  return rewriter.end();
}

export interface HtmlStreamRewriter {
  /** The rewritten markup that can no longer change, which may be less than was written. */
  write(chunk: string): string;
  end(): string;
}

/** Rewrites HTML as it arrives, so the browser can render the start of a page before the rest has loaded. */
export function createHtmlRewriter(options: Omit<HtmlRewriteOptions, "xml">): HtmlStreamRewriter {
  const rewriter = new HtmlRewriter({ ...options, xml: false }, true);
  return { write: (chunk) => rewriter.write(chunk), end: () => rewriter.end() ?? "" };
}

type Edit =
  { kind: "overwrite"; start: number; end: number; text: string } | { kind: "remove"; start: number; end: number };

class HtmlRewriter {
  readonly #options: HtmlRewriteOptions;
  readonly #scripts: boolean;
  readonly #streaming: boolean;
  #parser: Parser | null = null;
  /** The markup from `#flushed` on; everything before it has been handed out. */
  #pending = "";
  #flushed = 0;
  #received = 0;
  #fed = 0;
  /** The end of the last whole token, so nothing before it can gain an edit any more. */
  #settled = 0;
  #edits: Edit[] = [];
  #injected = false;
  #base: URL;
  readonly #owner: string;
  readonly #opaque: boolean;
  readonly #xml: boolean;
  #rootSeen = false;
  #removing: { name: string; start: number; depth: number } | null = null;
  #baseSeen = false;
  #injectAt = 0;
  #injectFrozen = false;
  #carried = false;
  #attributes: Attribute[] = [];
  #script: { start: number; contentStart: number; kind: ScriptKind } | null = null;
  #styleStart = -1;

  constructor(options: HtmlRewriteOptions, streaming: boolean) {
    this.#options = options;
    this.#scripts = options.scripts ?? true;
    this.#streaming = streaming;
    this.#base = options.url;
    this.#owner = options.owner ?? (isWebUrl(options.url) ? originOf(options.url) : "null");
    this.#opaque = options.opaque ?? false;
    this.#xml = options.xml ?? false;
  }

  write(chunk: string): string {
    this.#pending += chunk;
    this.#received += chunk.length;
    // An XML prolog is read whole before parsing starts.
    if (this.#xml || !this.#streaming) return "";
    const { inject } = this.#options;
    // Telling a runtime tag already in place from a page's own script takes the tag's whole length.
    this.#feed(this.#injectFrozen || !inject ? this.#received : this.#received - inject.length);
    if (this.#injectFrozen) this.#feed(this.#received);
    return this.#flush(false);
  }

  #feed(until: number): void {
    if (until <= this.#fed) return;
    const text = this.#raw(this.#fed, until);
    this.#fed = until;
    (this.#parser ??= this.#createParser()).write(text);
  }

  end(): string | null {
    if (this.#xml) {
      const prolog = scanProlog(this.#pending);
      if (!prolog) return null;
      for (const instruction of prolog.instructions) this.#prologInstruction(instruction);
      // Blanked, so the parser never sees the doctype's internal subset; offsets stay the same.
      this.#createParser().end(" ".repeat(prolog.root) + this.#pending.slice(prolog.root));
      if (this.#options.inject && !this.#rootSeen) return null;
    } else {
      this.#feed(this.#received);
      (this.#parser ??= this.#createParser()).end();
    }
    return this.#flush(true);
  }

  #createParser(): Parser {
    const parser: Parser = new Parser(
      {
        onprocessinginstruction: (name) => {
          this.#settled = parser.endIndex + 1;
          if (this.#xml) return;
          if (!this.#injectFrozen && name.toLowerCase() === "!doctype") this.#injectAt = parser.endIndex + 1;
        },
        oncommentend: () => {
          this.#settled = parser.endIndex + 1;
        },
        onattribute: (name, value) => {
          this.#attributes.push({ name, value, start: parser.startIndex, end: parser.endIndex });
        },
        onopentag: (name, attribs, implied) => {
          const attributes = this.#attributes;
          this.#attributes = [];
          if (implied && !this.#xml) return;
          this.#openTag(name, attribs, attributes, parser.startIndex, parser.endIndex);
          this.#settled = parser.endIndex + 1;
        },
        ontext: (text) => {
          this.#settled = parser.endIndex + 1;
          if (text.trim()) this.#injectFrozen = true;
        },
        onclosetag: (name, implied) => {
          // In XML only a self-closing tag is implied, and it still ends its element.
          if (implied && !this.#xml) return;
          this.#closeTag(name, parser.startIndex, parser.endIndex);
          this.#settled = parser.endIndex + 1;
        },
      },
      { decodeEntities: true, xmlMode: this.#xml },
    );
    return parser;
  }

  /**
   * Hands out the markup no later token can edit: up to the last whole token, and short of an open script, style or
   * element being dropped, whose edits come at its end. Nothing goes before the runtime tag's place is known.
   */
  #flush(final: boolean): string {
    let safe = this.#received;
    if (!final) {
      if (!this.#injectFrozen) return "";
      safe = this.#settled;
      if (this.#removing) safe = Math.min(safe, this.#removing.start);
      if (this.#script) safe = Math.min(safe, this.#script.contentStart);
      if (this.#styleStart >= 0) safe = Math.min(safe, this.#styleStart);
      if (safe <= this.#flushed) return "";
    }
    const from = this.#flushed;
    const output = new MagicString(this.#pending.slice(0, safe - from));
    const later: Edit[] = [];
    for (let index = 0; index < this.#edits.length; index++) {
      const edit = this.#edits[index] as Edit;
      if (edit.start >= safe && !final) later.push(edit);
      else if (edit.kind === "overwrite") output.overwrite(edit.start - from, edit.end - from, edit.text);
      else output.remove(edit.start - from, edit.end - from);
    }
    this.#edits = later;
    const { inject } = this.#options;
    if (inject && !this.#carried && !this.#injected) {
      this.#injected = true;
      output.appendLeft(this.#injectAt - from, inject);
    }
    this.#pending = this.#pending.slice(safe - from);
    this.#flushed = safe;
    return output.toString();
  }

  #raw(start: number, end: number): string {
    return this.#pending.slice(start - this.#flushed, end - this.#flushed);
  }

  #overwrite(start: number, end: number, text: string): void {
    this.#edits.push({ kind: "overwrite", start, end, text });
  }

  #remove(start: number, end: number): void {
    this.#edits.push({ kind: "remove", start, end });
  }

  #prologInstruction(instruction: XmlInstruction): void {
    const attributes = pseudoAttributes(instruction.data, instruction.dataStart);
    const find = (name: string) => attributes.find((attribute) => attribute.name === name);
    if (instruction.target === "xml") {
      // The body is sent as UTF-8, so the declaration has to agree with it.
      const encoding = find("encoding");
      if (encoding && keyword(encoding.value) !== "utf-8") this.#overwrite(encoding.start, encoding.end, "UTF-8");
      return;
    }
    if (instruction.target !== "xml-stylesheet") return;
    // An XSLT result replaces the document, runtime tag included, so only CSS stylesheets stay.
    if (keyword(find("type")?.value) !== "text/css") {
      this.#remove(instruction.start, instruction.end);
      return;
    }
    const href = find("href");
    const value = href && decodeReferences(href.value);
    if (!href || value == null) return;
    const rewritten = rewriteUrl(value, this.#base, this.#options.origin, this.#owner, this.#opaque);
    if (rewritten !== value) this.#overwrite(href.start, href.end, escapeXmlAttribute(rewritten));
  }

  #openTag(
    rawName: string,
    attribs: Record<string, string>,
    attributes: Attribute[],
    start: number,
    end: number,
  ): void {
    if (this.#removing) {
      if (rawName === this.#removing.name) this.#removing.depth++;
      return;
    }
    const name = this.#xml ? localName(rawName) : rawName;
    // Markup that already starts with the tag (a re-attached srcdoc) keeps that copy, untouched.
    const { inject } = this.#options;
    if (
      inject &&
      name === "script" &&
      !this.#injectFrozen &&
      start === this.#injectAt &&
      this.#raw(start, start + inject.length) === inject
    ) {
      this.#carried = true;
      this.#injectFrozen = true;
      return;
    }
    if (this.#xml) this.#placeXmlInject(rawName, name, end);
    else if (!this.#injectFrozen) {
      // The runtime must run before any script, so it goes in as early as the doctype, <html> and <head> allow.
      if (name === "html" || name === "head") this.#injectAt = end + 1;
      else this.#injectFrozen = true;
    }

    if (this.#removesElement(name, attribs)) {
      // XML has no void elements, so the element goes once its end tag is reached.
      if (name === "script" || this.#xml) this.#removing = { name: rawName, start, depth: 1 };
      else this.#remove(start, end + 1);
      return;
    }

    for (const attribute of attributes) this.#rewriteAttribute(name, attribs, attribute);

    if (name === "script") this.#script = { start, contentStart: end + 1, kind: this.#scriptKind(attribs.type) };
    if (name === "style") this.#styleStart = end + 1;
  }

  /** XML allows nothing outside the root, so the tag goes first inside it, or inside an XHTML head right after it. */
  #placeXmlInject(rawName: string, name: string, end: number): void {
    if (this.#injectFrozen) return;
    const selfClosing = this.#raw(end - 1, end) === "/";
    if (!this.#rootSeen) {
      this.#rootSeen = true;
      this.#injectFrozen = name !== "html";
      const { inject } = this.#options;
      if (!selfClosing) this.#injectAt = end + 1;
      else if (inject) {
        this.#overwrite(end - 1, end + 1, `>${inject}</${rawName}>`);
        this.#carried = true;
        this.#injectFrozen = true;
      }
      return;
    }
    if (name === "head" && !selfClosing) this.#injectAt = end + 1;
    this.#injectFrozen = true;
  }

  #closeTag(rawName: string, start: number, end: number): void {
    if (this.#removing) {
      if (rawName === this.#removing.name && --this.#removing.depth === 0) {
        this.#remove(this.#removing.start, end + 1);
        this.#removing = null;
      }
      return;
    }
    const name = this.#xml ? localName(rawName) : rawName;
    if (name === "script" && this.#script) {
      const { contentStart, kind } = this.#script;
      this.#script = null;
      this.#rewriteRange(contentStart, start, (text) => this.#rewriteScript(text, kind));
    } else if (name === "style" && this.#styleStart >= 0) {
      this.#rewriteRange(this.#styleStart, start, (text) =>
        rewriteCss(text, this.#base, this.#options.origin, this.#opaque),
      );
      this.#styleStart = -1;
    }
  }

  #removesElement(name: string, attribs: Record<string, string>): boolean {
    if (name === "link") return tokens(attribs.rel).some((rel) => DROPPED_LINK_RELS.has(rel));
    if (name === "meta") return setHas(DROPPED_META, keyword(attribs["http-equiv"]));
    if (name === "script") return keyword(attribs.type) === "speculationrules";
    return false;
  }

  #rewriteAttribute(tag: string, attribs: Record<string, string>, attribute: Attribute): void {
    const { name } = attribute;
    if (
      setHas(DROPPED_ATTRIBUTES, name) ||
      (tag === "iframe" && (name === "csp" || name === "credentialless")) ||
      (tag === "html" && name === "manifest")
    ) {
      this.#removeAttribute(attribute);
      return;
    }
    const value = this.#xml ? this.#xmlAttributeValue(attribute) : attribute.value;
    if (value === null) return;
    let rewritten = this.#rewriteValue(tag, attribs, name, value);
    rewritten = this.#options.attribute?.(tag, attribs, name, rewritten) ?? rewritten;
    if (rewritten !== value) {
      if (this.#xml) {
        this.#overwrite(attribute.start, attribute.end, `${name}="${escapeXmlAttribute(rewritten)}"`);
        return;
      }
      // Only a srcdoc that gets the runtime tag is written with `<` escaped.
      const text = escapeAttribute(rewritten);
      const escaped =
        tag === "iframe" && name === "srcdoc" && this.#options.frameInject ? text.replace(/</g, "&lt;") : text;
      this.#overwrite(attribute.start, attribute.end, `${name}="${escaped}"`);
    }
  }

  /** The value as an XML parser reads it. Null when it names a doctype entity, which only the browser can expand. */
  #xmlAttributeValue(attribute: Attribute): string | null {
    const raw = this.#raw(attribute.start, attribute.end);
    const match = /^[^=]*=\s*(?:"([^"]*)"|'([^']*)')$/.exec(raw);
    const quoted = match?.[1] ?? match?.[2];
    return quoted === undefined ? null : decodeReferences(quoted.replace(/\r\n|[\t\n\r]/g, " "));
  }

  #rewriteValue(tag: string, attribs: Record<string, string>, name: string, value: string): string {
    const { origin } = this.#options;
    if (tag === "iframe" && name === "sandbox") {
      // Without allow-same-origin the frame gets an opaque origin and its requests skip the service worker.
      if (tokens(value).includes("allow-same-origin")) return value;
      return [value.trim(), "allow-same-origin"].filter(Boolean).join(" ");
    }
    if (setHas(URL_ATTRIBUTES, name) || (name === "data" && tag === "object")) {
      if (tag === "link" && name === "href" && !tokens(attribs.rel).some((rel) => FETCHED_LINK_RELS.has(rel))) {
        return value;
      }
      // A javascript: URL is left as written where scripts are not rewritten.
      if (!this.#scripts && rewriteJavascriptUrl(value, this.#owner) !== null) return value;
      const rewritten = rewriteUrl(value, this.#base, origin, this.#owner, this.#opaque);
      if (tag === "base" && name === "href" && !this.#baseSeen) {
        this.#baseSeen = true;
        try {
          const base = new URL(value.trim(), this.#base);
          // A base that is not a web URL would leave nothing to proxy relative URLs against.
          if (base.protocol === "http:" || base.protocol === "https:") this.#base = base;
        } catch {
          // Browsers ignore a base URL they cannot parse, and so do we.
        }
      }
      if (!setHas(DOCUMENT_URLS, `${tag} ${name}`)) return rewritten;
      const { swapBlob } = this.#options;
      if (swapBlob) return swapBlob(rewritten);
      // The service worker cannot make a bootstrap in the page's realm, so a blob document stays unloaded.
      return isBlobUrl(rewritten) ? "about:blank" : rewritten;
    }
    if (setHas(SRCSET_ATTRIBUTES, name)) {
      let changed = false;
      const rewritten = rewriteSrcset(value, (url) => {
        const next = rewriteUrl(url, this.#base, origin, undefined, this.#opaque);
        if (next !== url) changed = true;
        return next;
      });
      return changed ? rewritten : value;
    }
    if (name === "style" || (setHas(PAINT_ATTRIBUTES, name) && value.includes("url("))) {
      return rewriteCss(value, this.#base, origin, this.#opaque);
    }
    if (name.startsWith("on")) return this.#scripts ? rewriteJs(value, { kind: "handler" }) : value;
    if (tag === "iframe" && name === "srcdoc") {
      const { frameInject } = this.#options;
      if (!frameInject) {
        return rewriteHtml(value, {
          url: this.#base,
          origin,
          scripts: false,
          owner: this.#owner,
          opaque: this.#opaque,
        });
      }
      return rewriteHtml(value, {
        url: this.#base,
        origin,
        scripts: true,
        inject: frameInject(this.#base),
        frameInject,
        swapBlob: this.#options.swapBlob,
        owner: this.#owner,
        opaque: this.#opaque,
      });
    }
    if (tag === "meta" && name === "content" && keyword(attribs["http-equiv"]) === "refresh") {
      return rewriteRefresh(value, this.#base, origin, this.#opaque);
    }
    return value;
  }

  #removeAttribute(attribute: Attribute): void {
    let start = attribute.start;
    while (start > this.#flushed && /\s/.test(this.#raw(start - 1, start))) start--;
    this.#remove(start, attribute.end);
  }

  #scriptKind(type: string | undefined): ScriptKind {
    const value = keyword(type);
    if (value === "importmap") return "importmap";
    if (!this.#scripts) return "none";
    if (value === "") return "classic";
    if (value === "module") return "module";
    return JS_TYPE.test(value) ? "classic" : "none";
  }

  #rewriteScript(text: string, kind: ScriptKind): string {
    if (kind === "classic" || kind === "module") return rewriteJs(text, { kind });
    if (kind === "importmap") return rewriteImportMap(text, this.#base, this.#options.origin, this.#opaque);
    return text;
  }

  #rewriteRange(start: number, end: number, rewrite: (text: string) => string): void {
    if (end <= start) return;
    const raw = this.#raw(start, end);
    // XML element text can hold references and CDATA sections, so it is decoded first and escaped again after.
    const text = this.#xml ? decodeCharacterData(raw) : raw;
    if (text === null) return;
    const rewritten = rewrite(text);
    if (rewritten !== text) this.#overwrite(start, end, this.#xml ? escapeCharacterData(rewritten) : rewritten);
  }
}

/** Bare specifiers in "imports" stay keys; URL values and scope prefixes have to point at the proxy. */
export function rewriteImportMap(text: string, base: URL, origin: string, opaque: boolean): string {
  let map: unknown;
  try {
    map = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(map)) return text;
  let changed = false;
  const rewrite = (url: string) => {
    const next = rewriteUrl(url, base, origin, undefined, opaque);
    if (next !== url) changed = true;
    return next;
  };
  const rewriteValues = (entries: unknown) =>
    isRecord(entries)
      ? Object.fromEntries(
          Object.entries(entries).map(([key, url]) => [key, typeof url === "string" ? rewrite(url) : url]),
        )
      : entries;

  const result: Record<string, unknown> = { ...map };
  if ("imports" in map) result.imports = rewriteValues(map.imports);
  if (isRecord(map.scopes)) {
    result.scopes = Object.fromEntries(
      Object.entries(map.scopes).map(([scope, entries]) => [rewrite(scope), rewriteValues(entries)]),
    );
  }
  return changed ? JSON.stringify(result) : text;
}

/** An attribute keyword as the browser compares it, through methods a page cannot replace. */
export function keyword(value: string | undefined | null): string {
  return lowerCase(trim(value ?? ""));
}

/** A prefixed XML name such as `svg:script` without its prefix. */
function localName(name: string): string {
  return name.slice(name.indexOf(":") + 1);
}

function tokens(value: string | undefined): string[] {
  return (value ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
