export type BodyKind = "html" | "css" | "js";

/** Only bodies the browser will parse as a document, stylesheet or script need rewriting; fetch() data stays untouched. */
export function rewriteKind(
  destination: RequestDestination,
  navigation: boolean,
  contentType: string | null,
): BodyKind | null {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (navigation) return type === "text/html" ? "html" : null;
  if (destination === "style") return type === "" || type.includes("css") ? "css" : null;
  if (destination === "script") return type === "" || /(?:java|ecma)script/.test(type) ? "js" : null;
  return null;
}

export function decodeText(bytes: ArrayBuffer, contentType: string | null): string {
  const label = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}
