import { PROXY_PREFIX } from "../shared/codec.ts";
import { rewriteSrcset, rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "xlink:href"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
const INTEGRITY_ELEMENTS = new Set(["script", "link"]);

export function attributeKind(element: string, name: string): "url" | "srcset" | "integrity" | null {
  const attribute = name.toLowerCase();
  if (URL_ATTRIBUTES.has(attribute) || (attribute === "data" && element.toLowerCase() === "object")) return "url";
  if (attribute === "integrity" && INTEGRITY_ELEMENTS.has(element.toLowerCase())) return "integrity";
  return SRCSET_ATTRIBUTES.has(attribute) ? "srcset" : null;
}

export function rewriteAttribute(element: string, name: string, value: string, base: URL, origin: string): string {
  switch (attributeKind(element, name)) {
    case "url":
      return rewriteUrl(value, base, origin);
    case "srcset":
      return rewriteSrcset(value, (url) => rewriteUrl(url, base, origin));
    // The proxy rewrites scripts and styles, so their hash no longer matches; an empty value turns the check off.
    case "integrity":
      return "";
    default:
      return value;
  }
}

/** Values the page wrote itself, relative ones included, come back exactly as written. */
export function restoreAttribute(element: string, name: string, value: string, base: URL, origin: string): string {
  const restore = (url: string) => {
    const trimmed = url.trim();
    return trimmed.startsWith(PROXY_PREFIX) || trimmed.startsWith(`${origin}/`)
      ? unrewriteUrl(trimmed, base, origin)
      : url;
  };
  switch (attributeKind(element, name)) {
    case "url":
      return restore(value);
    case "srcset":
      return rewriteSrcset(value, restore);
    default:
      return value;
  }
}
