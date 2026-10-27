import { Parser } from "htmlparser2";
import MagicString from "magic-string";
import { rewriteHtml } from "../rewrite/html.ts";
import { rewriteJs } from "../rewrite/js.ts";
import { attributeKind, restoreAttribute } from "./attribute-values.ts";
import type { UrlContext } from "./url-context.ts";

/** The rewriters, bound to the page's current real base, so the runtime can rewrite code and markup synchronously. */
export interface RewriteBridge {
  js(code: string): string;
  html(html: string): string;
  unhtml(html: string): string;
  importSpecifier(spec: string): string;
  metaUrl(url: string): string;
}

export function createRewriteBridge(
  ctx: Pick<UrlContext, "origin" | "realBase" | "toProxy" | "fromProxy">,
): RewriteBridge {
  return {
    js: (code) => rewriteJs(code),
    html: (html) => rewriteHtml(html, { url: ctx.realBase(), origin: ctx.origin, scripts: true }),
    unhtml: (html) => unrewriteHtmlAttributes(html, ctx.realBase(), ctx.origin),
    importSpecifier: (spec) => ctx.toProxy(spec),
    metaUrl: (url) => ctx.fromProxy(url),
  };
}

interface PendingAttribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

/** Turns the proxy URLs the DOM holds back into real ones, so a page reading innerHTML sees what it wrote. */
function unrewriteHtmlAttributes(html: string, base: URL, origin: string): string {
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
          const restored = restoreAttribute(name, attribute.name, attribute.value, base, origin);
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
