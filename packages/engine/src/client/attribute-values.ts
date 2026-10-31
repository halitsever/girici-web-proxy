import { PROXY_PREFIX } from "../shared/codec.ts";
import { rewriteSrcset, rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "xlink:href"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
const WRAPPED_SCRIPT = "javascript:__g$.J(";
const INTEGRITY_ELEMENTS = new Set(["script", "link"]);

export type AttributeKind = "url" | "srcset" | "integrity" | "html";

export function attributeKind(element: string, name: string): AttributeKind | null {
  const attribute = name.toLowerCase();
  if (attribute === "srcdoc" && element.toLowerCase() === "iframe") return "html";
  if (URL_ATTRIBUTES.has(attribute) || (attribute === "data" && element.toLowerCase() === "object")) return "url";
  if (attribute === "integrity" && INTEGRITY_ELEMENTS.has(element.toLowerCase())) return "integrity";
  return SRCSET_ATTRIBUTES.has(attribute) ? "srcset" : null;
}

export function rewriteAttribute(
  element: string,
  name: string,
  value: string,
  base: URL,
  origin: string,
  html?: (markup: string) => string,
): string {
  switch (attributeKind(element, name)) {
    case "url":
      return rewriteUrl(value, base, origin);
    case "srcset":
      return rewriteSrcset(value, (url) => rewriteUrl(url, base, origin));
    // The proxy rewrites scripts and styles, so their hash no longer matches; an empty value turns the check off.
    case "integrity":
      return "";
    case "html":
      return html ? html(value) : value;
    default:
      return value;
  }
}

/** Values the page wrote itself, relative ones included, come back exactly as written. */
export function restoreAttribute(
  element: string,
  name: string,
  value: string,
  base: URL,
  origin: string,
  unhtml?: (markup: string) => string,
): string {
  const restore = (url: string) => {
    const trimmed = url.trim();
    return trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(`${origin}/`) || trimmed.startsWith(WRAPPED_SCRIPT)
      ? unrewriteUrl(trimmed, base, origin)
      : url;
  };
  switch (attributeKind(element, name)) {
    case "url":
      return restore(value);
    case "srcset":
      return rewriteSrcset(value, restore);
    case "html":
      return unhtml ? unhtml(value) : value;
    default:
      return value;
  }
}
