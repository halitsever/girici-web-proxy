import { Parser } from "htmlparser2";
import MagicString from "magic-string";
import { rewriteHtml } from "../rewrite/html.ts";
import { rewriteJs } from "../rewrite/js.ts";
import { stripClientTag } from "../shared/client-tag.ts";
import { attributeKind, restoreAttribute } from "./attribute-values.ts";
import type { UrlContext } from "./url-context.ts";

/** The rewriters, bound to the page's current real base, so the runtime can rewrite code and markup synchronously. */
export interface RewriteBridge {
  js(code: string): string;
  jsBody(code: string): string;
  html(html: string): string;
  /** A srcdoc document with the runtime tag in front, since it has no address to load the runtime through. */
  srcdoc(markup: string): string;
  unhtml(html: string): string;
  unsrcdoc(markup: string): string;
  importSpecifier(spec: string): string;
  metaUrl(url: string): string;
}

export function createRewriteBridge(
  ctx: Pick<UrlContext, "origin" | "realBase" | "toProxy" | "fromProxy">,
  frameTag: (base: URL) => string,
): RewriteBridge {
  const html = (markup: string) =>
    rewriteHtml(markup, { url: ctx.realBase(), origin: ctx.origin, scripts: true, frameInject: frameTag });
  const clientUrl = () => tagSource(frameTag(ctx.realBase()));
  // Nested srcdoc values come back through the same path, so the tag goes at every level.
  const unsrcdoc = (markup: string): string =>
    stripClientTag(unrewriteHtmlAttributes(markup, ctx.realBase(), ctx.origin, unsrcdoc), clientUrl());
  return {
    js: (code) => rewriteJs(code),
    // Function constructor bodies allow a top-level return, so they parse as a function body, not a script.
    jsBody: (code) => rewriteJs(code, { kind: "handler" }),
    html,
    // A tag carried over from an earlier rewrite is dropped first, since its cookie snapshot may be stale.
    srcdoc: (markup) =>
      rewriteHtml(stripClientTag(markup, clientUrl()), {
        url: ctx.realBase(),
        origin: ctx.origin,
        scripts: true,
        inject: frameTag(ctx.realBase()),
        frameInject: frameTag,
      }),
    unhtml: (markup) => unrewriteHtmlAttributes(markup, ctx.realBase(), ctx.origin, unsrcdoc),
    unsrcdoc,
    importSpecifier: (spec) => ctx.toProxy(spec),
    metaUrl: (url) => ctx.fromProxy(url),
  };
}

/** The runtime address, read from the tag itself so the bridge needs no second copy of it. */
function tagSource(tag: string): string {
  return /^<script src="([^"]*)"/.exec(tag)?.[1] ?? "";
}

interface PendingAttribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

/** Turns the proxy URLs the DOM holds back into real ones, so a page reading innerHTML sees what it wrote. */
function unrewriteHtmlAttributes(
  html: string,
  base: URL,
  origin: string,
  unsrcdoc: (markup: string) => string,
): string {
  const output = new MagicString(html);
  let attributes: PendingAttribute[] = [];
  const parser: Parser = new Parser(
    {
      onattribute: (name, value) => {
        attributes.push({ name, value, start: parser.startIndex, end: parser.endIndex });
      },
      onopentag: (name, _attribs, implied) => {
        const pending = attributes;
        attributes = [];
        if (implied) return;
        for (const attribute of pending) {
          if (!attributeKind(name, attribute.name)) continue;
          const restored = restoreAttribute(name, attribute.name, attribute.value, base, origin, unsrcdoc);
          if (restored !== attribute.value) {
            output.overwrite(attribute.start, attribute.end, `${attribute.name}="${escapeAttribute(restored)}"`);
          }
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  return output.hasChanged() ? output.toString() : html;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
