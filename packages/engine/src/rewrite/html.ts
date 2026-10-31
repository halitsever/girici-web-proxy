import { Parser } from "htmlparser2";
import MagicString from "magic-string";
import { rewriteSrcset, rewriteUrl } from "../shared/url-rewrite.ts";
import { rewriteCss } from "./css.ts";
import { rewriteJs } from "./js.ts";
import { rewriteRefresh } from "./refresh.ts";

export interface HtmlRewriteOptions {
  url: URL;
  origin: string;
  inject?: string;
  scripts?: boolean;
  /** Runtime tag for a srcdoc document, which has no address of its own to load the runtime through. */
  frameInject?: (base: URL) => string;
  /** The runtime's blob swap for URLs that load a document, so a blob page starts with the runtime in place. */
  swapBlob?: (url: string) => string;
}

interface Attribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

type ScriptKind = "classic" | "module" | "importmap" | "remove" | "none";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "xlink:href"]);
const DOCUMENT_URLS = new Set(["iframe src", "frame src", "embed src", "object data"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
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
const JAVASCRIPT_URL = /^\s*javascript:/i;

/** Edits attribute and inline code ranges in place; the document is never re-serialised, so markup quirks survive. */
export function rewriteHtml(html: string, options: HtmlRewriteOptions): string {
  return new HtmlRewriter(html, options).run();
}

class HtmlRewriter {
  readonly #html: string;
  readonly #options: HtmlRewriteOptions;
  readonly #scripts: boolean;
  readonly #output: MagicString;
  #base: URL;
  #baseSeen = false;
  #injectAt = 0;
  #injectFrozen = false;
  #attributes: Attribute[] = [];
  #script: { start: number; contentStart: number; kind: ScriptKind } | null = null;
  #styleStart = -1;

  constructor(html: string, options: HtmlRewriteOptions) {
    this.#html = html;
    this.#options = options;
    this.#scripts = options.scripts ?? true;
    this.#output = new MagicString(html);
    this.#base = options.url;
  }

  run(): string {
    const parser: Parser = new Parser(
      {
        onprocessinginstruction: (name) => {
          if (!this.#injectFrozen && name.toLowerCase() === "!doctype") this.#injectAt = parser.endIndex + 1;
        },
        onattribute: (name, value) => {
          this.#attributes.push({ name, value, start: parser.startIndex, end: parser.endIndex });
        },
        onopentag: (name, attribs, implied) => {
          const attributes = this.#attributes;
          this.#attributes = [];
          if (implied) return;
          this.#openTag(name, attribs, attributes, parser.startIndex, parser.endIndex);
        },
        ontext: (text) => {
          if (text.trim()) this.#injectFrozen = true;
        },
        onclosetag: (name, implied) => {
          if (!implied) this.#closeTag(name, parser.startIndex, parser.endIndex);
        },
      },
      { decodeEntities: true },
    );
    parser.end(this.#html);
    if (this.#options.inject) this.#output.appendLeft(this.#injectAt, this.#options.inject);
    return this.#output.hasChanged() ? this.#output.toString() : this.#html;
  }

  #openTag(name: string, attribs: Record<string, string>, attributes: Attribute[], start: number, end: number): void {
    if (!this.#injectFrozen) {
      // The runtime must run before any script, so it goes in as early as the doctype, <html> and <head> allow.
      if (name === "html" || name === "head") this.#injectAt = end + 1;
      else this.#injectFrozen = true;
    }

    if (this.#removesElement(name, attribs)) {
      if (name === "script") this.#script = { start, contentStart: end + 1, kind: "remove" };
      else this.#output.remove(start, end + 1);
      return;
    }

    for (const attribute of attributes) this.#rewriteAttribute(name, attribs, attribute);

    if (name === "script") this.#script = { start, contentStart: end + 1, kind: this.#scriptKind(attribs.type) };
    if (name === "style") this.#styleStart = end + 1;
  }

  #closeTag(name: string, start: number, end: number): void {
    if (name === "script" && this.#script) {
      const { start: scriptStart, contentStart, kind } = this.#script;
      this.#script = null;
      if (kind === "remove") this.#output.remove(scriptStart, end + 1);
      else this.#rewriteRange(contentStart, start, (text) => this.#rewriteScript(text, kind));
    } else if (name === "style" && this.#styleStart >= 0) {
      this.#rewriteRange(this.#styleStart, start, (text) => rewriteCss(text, this.#base, this.#options.origin));
      this.#styleStart = -1;
    }
  }

  #removesElement(name: string, attribs: Record<string, string>): boolean {
    if (name === "link") return tokens(attribs.rel).some((rel) => DROPPED_LINK_RELS.has(rel));
    if (name === "meta") return DROPPED_META.has((attribs["http-equiv"] ?? "").trim().toLowerCase());
    if (name === "script") return (attribs.type ?? "").trim().toLowerCase() === "speculationrules";
    return false;
  }

  #rewriteAttribute(tag: string, attribs: Record<string, string>, attribute: Attribute): void {
    const { name, value } = attribute;
    if (
      DROPPED_ATTRIBUTES.has(name) ||
      (tag === "iframe" && (name === "csp" || name === "credentialless")) ||
      (tag === "html" && name === "manifest")
    ) {
      this.#removeAttribute(attribute);
      return;
    }
    const rewritten = this.#rewriteValue(tag, attribs, name, value);
    if (rewritten !== value) {
      // A document that carries the runtime tag has its markup written out as text.
      const text = escapeAttribute(rewritten);
      const escaped = name === "srcdoc" && this.#options.frameInject ? text.replace(/</g, "&lt;") : text;
      this.#output.overwrite(attribute.start, attribute.end, `${name}="${escaped}"`);
    }
  }

  #rewriteValue(tag: string, attribs: Record<string, string>, name: string, value: string): string {
    const { origin } = this.#options;
    if (tag === "iframe" && name === "sandbox") {
      // Without allow-same-origin the frame gets an opaque origin and its requests skip the service worker.
      if (tokens(value).includes("allow-same-origin")) return value;
      return [value.trim(), "allow-same-origin"].filter(Boolean).join(" ");
    }
    if (URL_ATTRIBUTES.has(name) || (name === "data" && tag === "object")) {
      if (tag === "link" && name === "href" && !tokens(attribs.rel).some((rel) => FETCHED_LINK_RELS.has(rel))) {
        return value;
      }
      if (JAVASCRIPT_URL.test(value)) return this.#scripts ? rewriteJavascriptUrl(value) : value;
      const rewritten = rewriteUrl(value, this.#base, origin);
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
      const { swapBlob } = this.#options;
      return swapBlob && DOCUMENT_URLS.has(`${tag} ${name}`) ? swapBlob(rewritten) : rewritten;
    }
    if (SRCSET_ATTRIBUTES.has(name)) {
      let changed = false;
      const rewritten = rewriteSrcset(value, (url) => {
        const next = rewriteUrl(url, this.#base, origin);
        if (next !== url) changed = true;
        return next;
      });
      return changed ? rewritten : value;
    }
    if (name === "style") return rewriteCss(value, this.#base, origin);
    if (name.startsWith("on")) return this.#scripts ? rewriteJs(value, { kind: "handler" }) : value;
    if (name === "srcdoc") {
      const { frameInject } = this.#options;
      if (!frameInject) return rewriteHtml(value, { url: this.#base, origin, scripts: false });
      return rewriteHtml(value, {
        url: this.#base,
        origin,
        scripts: true,
        inject: frameInject(this.#base),
        frameInject,
        swapBlob: this.#options.swapBlob,
      });
    }
    if (tag === "meta" && name === "content" && (attribs["http-equiv"] ?? "").trim().toLowerCase() === "refresh") {
      return rewriteRefresh(value, this.#base, origin, this.#options.swapBlob);
    }
    return value;
  }

  #removeAttribute(attribute: Attribute): void {
    let start = attribute.start;
    while (start > 0 && /\s/.test(this.#html[start - 1] ?? "")) start--;
    this.#output.remove(start, attribute.end);
  }

  #scriptKind(type: string | undefined): ScriptKind {
    const value = (type ?? "").trim().toLowerCase();
    if (value === "importmap") return "importmap";
    if (!this.#scripts) return "none";
    if (value === "") return "classic";
    if (value === "module") return "module";
    return JS_TYPE.test(value) ? "classic" : "none";
  }

  #rewriteScript(text: string, kind: ScriptKind): string {
    if (kind === "classic" || kind === "module") return rewriteJs(text, { kind });
    if (kind === "importmap") return rewriteImportMap(text, this.#base, this.#options.origin);
    return text;
  }

  #rewriteRange(start: number, end: number, rewrite: (text: string) => string): void {
    if (end <= start) return;
    const text = this.#html.slice(start, end);
    const rewritten = rewrite(text);
    if (rewritten !== text) this.#output.overwrite(start, end, rewritten);
  }
}

/** The browser percent-decodes javascript: URLs before running them, so any % in the rewritten code is escaped again. */
function rewriteJavascriptUrl(value: string): string {
  const prefix = value.slice(0, value.indexOf(":") + 1);
  let code: string;
  try {
    code = decodeURIComponent(value.slice(prefix.length));
  } catch {
    return value;
  }
  const rewritten = rewriteJs(code);
  return rewritten === code ? value : prefix + rewritten.replace(/%/g, "%25");
}

/** Bare specifiers in "imports" stay keys; URL values and scope prefixes have to point at the proxy. */
function rewriteImportMap(text: string, base: URL, origin: string): string {
  let map: unknown;
  try {
    map = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isRecord(map)) return text;
  let changed = false;
  const rewrite = (url: string) => {
    const next = rewriteUrl(url, base, origin);
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

function tokens(value: string | undefined): string[] {
  return (value ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
