const LINK = /https?:\/\/[^\s<>"'“”]+/i;
const TRAILING = /[.,;:!?)\]]+$/;
const MAX_LENGTH = 2048;

/**
 * What a share from another app (`url`, `text`) or a search shortcut (`q`) puts in the address box. Many apps share
 * a link inside the text, so the first link there wins over the rest of it.
 */
export function sharedInput(params: URLSearchParams): string | null {
  const url = params.get("url")?.trim();
  const text = params.get("text")?.trim();
  const link = text?.match(LINK)?.[0].replace(TRAILING, "");
  const value = url || link || text || params.get("q")?.trim();
  return value ? value.slice(0, MAX_LENGTH) : null;
}
