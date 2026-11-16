import {
  append,
  charCodeAt,
  indexOf,
  isNotANumber,
  lowerCase,
  sliceOf,
  splitText,
  toNumber,
  trim,
} from "../primordials.ts";

export type Lang = "en" | "tr" | "es" | "pt-BR" | "fr" | "de" | "ru" | "fa" | "ar" | "zh-CN" | "id" | "vi";

export interface LanguageInfo {
  readonly code: Lang;
  /** The language's name in itself, as a picker shows it to someone who reads only that language. */
  readonly name: string;
  readonly dir: "ltr" | "rtl";
}

export const DEFAULT_LANG: Lang = "en";

const language = (code: Lang, name: string, dir: "ltr" | "rtl" = "ltr"): LanguageInfo =>
  Object.freeze({ code, name, dir });

export const LANGUAGES: readonly LanguageInfo[] = Object.freeze([
  language("en", "English"),
  language("tr", "Türkçe"),
  language("es", "Español"),
  language("pt-BR", "Português (Brasil)"),
  language("fr", "Français"),
  language("de", "Deutsch"),
  language("ru", "Русский"),
  language("fa", "فارسی", "rtl"),
  language("ar", "العربية", "rtl"),
  language("zh-CN", "简体中文"),
  language("id", "Bahasa Indonesia"),
  language("vi", "Tiếng Việt"),
]);

const DIRECTIONS = { __proto__: null } as unknown as Record<string, "ltr" | "rtl" | undefined>;
const EXACT = { __proto__: null } as unknown as Record<string, Lang | undefined>;
/** "in" is the code Indonesian had before 1989, and some systems still send it. */
const PRIMARY = { __proto__: null, in: "id" } as unknown as Record<string, Lang | undefined>;
for (let index = 0; index < LANGUAGES.length; index++) {
  const { code, dir } = LANGUAGES[index] as LanguageInfo;
  DIRECTIONS[code] = dir;
  EXACT[lowerCase(code)] = code;
  // Any region of a primary language gets the one variant we ship: pt-PT reads pt-BR, zh-TW reads zh-CN.
  PRIMARY[primaryOf(lowerCase(code))] = code;
}

function primaryOf(range: string): string {
  const dash = indexOf(range, "-");
  return dash < 0 ? range : sliceOf(range, 0, dash);
}

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && DIRECTIONS[value] !== undefined;
}

export function directionOf(lang: Lang): "ltr" | "rtl" {
  return DIRECTIONS[lang] ?? "ltr";
}

/** The first range we ship, by its exact code in any case or else by its primary subtag. */
export function negotiateLanguage(ranges: readonly string[]): Lang {
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    if (typeof range !== "string") continue;
    const lower = lowerCase(range);
    const found = EXACT[lower] ?? PRIMARY[primaryOf(lower)];
    if (found) return found;
  }
  return DEFAULT_LANG;
}

const MAX_RANGES = 20;
/** RFC 5646's longest tag worth supporting. */
const MAX_RANGE_LENGTH = 35;

/** The first twenty usable ranges, highest weight first and in header order within a weight. */
export function parseAcceptLanguage(header: string | undefined): string[] {
  const ranges: string[] = [];
  if (typeof header !== "string") return ranges;
  const weights: number[] = [];
  const entries = splitText(header, ",");
  for (let index = 0; index < entries.length && ranges.length < MAX_RANGES; index++) {
    const parts = splitText(entries[index] as string, ";");
    const range = trim(parts[0] as string);
    const weight = weightOf(parts);
    if (!isRange(range) || !(weight > 0)) continue;
    append(ranges, range);
    append(weights, weight);
    let at = ranges.length - 1;
    for (; at > 0 && (weights[at - 1] as number) < weight; at--) {
      ranges[at] = ranges[at - 1] as string;
      weights[at] = weights[at - 1] as number;
    }
    ranges[at] = range;
    weights[at] = weight;
  }
  return ranges;
}

/** The `q` parameter, 1 without one, NaN for a value outside 0 to 1. */
function weightOf(parts: readonly string[]): number {
  for (let index = 1; index < parts.length; index++) {
    const param = trim(parts[index] as string);
    if (lowerCase(sliceOf(param, 0, 2)) !== "q=") continue;
    const value = sliceOf(param, 2);
    const weight = value === "" ? NaN : toNumber(value);
    return isNotANumber(weight) || weight < 0 || weight > 1 ? NaN : weight;
  }
  return 1;
}

/** Letters, digits and dashes only, so `*` and anything odd never reach a lookup. */
function isRange(range: string): boolean {
  if (range.length === 0 || range.length > MAX_RANGE_LENGTH) return false;
  for (let index = 0; index < range.length; index++) {
    const code = charCodeAt(range, index);
    const alphanumeric = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (!alphanumeric && code !== 45) return false;
  }
  return true;
}
