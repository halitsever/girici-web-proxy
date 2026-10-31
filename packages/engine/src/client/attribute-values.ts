import { PROXY_PREFIX } from "../shared/codec.ts";
import { lowerCase, setHas, startsWith, trim } from "../shared/primordials.ts";
import { rewriteSrcset, rewriteUrl, unrewriteUrl } from "../shared/url-rewrite.ts";

const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "poster", "background", "xlink:href"]);
const SRCSET_ATTRIBUTES = new Set(["srcset", "imagesrcset"]);
const WRAPPED_SCRIPT = "javascript:__g$.J(";
const INTEGRITY_ELEMENTS = new Set(["script", "link"]);

export type AttributeKind = "url" | "srcset" | "integrity" | "html";

export function attributeKind(element: string, name: string): AttributeKind | null {
  const attribute = lowerCase(name);
  if (attribute === "srcdoc" && lowerCase(element) === "iframe") return "html";
  if (setHas(URL_ATTRIBUTES, attribute) || (attribute === "data" && lowerCase(element) === "object")) return "url";
  if (attribute === "integrity" && setHas(INTEGRITY_ELEMENTS, lowerCase(element))) return "integrity";
  return setHas(SRCSET_ATTRIBUTES, attribute) ? "srcset" : null;
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
    const trimmed = trim(url);
    return startsWith(trimmed, PROXY_PREFIX) || startsWith(trimmed, `${origin}/`) || startsWith(trimmed, WRAPPED_SCRIPT)
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
