import { rewriteHtml } from "../rewrite/html.ts";
import { rewriteJs } from "../rewrite/js.ts";
import type { UrlContext } from "./url-context.ts";

/** The rewriters, bound to the page's current real base, so the runtime can rewrite code and markup synchronously. */
export interface RewriteBridge {
  js(code: string): string;
  html(html: string): string;
  importSpecifier(spec: string): string;
  metaUrl(url: string): string;
}

export function createRewriteBridge(
  ctx: Pick<UrlContext, "origin" | "realBase" | "toProxy" | "fromProxy">,
): RewriteBridge {
  return {
    js: (code) => rewriteJs(code),
    html: (html) => rewriteHtml(html, { url: ctx.realBase(), origin: ctx.origin, scripts: true }),
    importSpecifier: (spec) => ctx.toProxy(spec),
    metaUrl: (url) => ctx.fromProxy(url),
  };
}
