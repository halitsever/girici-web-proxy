import { lowerCase, ownValue, sliceOf } from "../primordials.ts";
import { DEFAULT_LANG, isLang, negotiateLanguage, type Lang } from "./languages.ts";

/** One surface's texts by language. English is the source, and every language without a catalog reads it. */
export type Catalogs<T> = { readonly en: T } & { readonly [L in Lang]?: T };

/** What the UI's language setting holds: a language, or "auto" for the browser's own list. */
export type LangChoice = Lang | "auto";

export function isLangChoice(value: unknown): value is LangChoice {
  return value === "auto" || isLang(value);
}

/**
 * The UI's choice when a catalog covers it, else the first browser range one covers. Ranges with no catalog yet are
 * skipped, so "de, tr" reads Turkish rather than English.
 */
export function pickLanguage(catalogs: Catalogs<unknown>, choice: unknown, ranges: readonly string[]): Lang {
  if (isLang(choice) && ownValue(catalogs, choice) !== undefined) return choice;
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (typeof range !== "string") continue;
    const lang = negotiateLanguage([range]);
    // negotiateLanguage answers English for a range it does not know, so English counts only when asked for.
    if (lang === DEFAULT_LANG ? isEnglish(range) : ownValue(catalogs, lang) !== undefined) return lang;
  }
  return DEFAULT_LANG;
}

export function textFor<T>(catalogs: Catalogs<T>, lang: Lang): T {
  return (ownValue(catalogs, lang) as T | undefined) ?? catalogs.en;
}

function isEnglish(range: string): boolean {
  const lower = lowerCase(range);
  return lower === "en" || sliceOf(lower, 0, 3) === "en-";
}
