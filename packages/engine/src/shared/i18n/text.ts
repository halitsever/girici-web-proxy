import { apply, charCodeAt, indexOf, ownValue, sliceOf, toText } from "../primordials.ts";
import type { Lang } from "./languages.ts";

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type PluralForms = { other: string } & Partial<Record<Exclude<PluralCategory, "other">, string>>;
export type TextParams = Readonly<Record<string, string | number>>;

const NativePluralRules = typeof Intl === "object" ? Intl.PluralRules : undefined;
const nativeSelect = NativePluralRules?.prototype.select;
/** One rule set per language, made on first use so a page load builds none it never shows. */
const RULES = { __proto__: null } as unknown as Record<string, Intl.PluralRules | null | undefined>;

/** Replaces each `{name}` (ASCII letters) with that own property of `params`; any other name stays as written. */
export function fill(template: string, params?: TextParams): string {
  return fillWith(template, params);
}

/**
 * The form `Intl.PluralRules` picks for `count` in `lang`, else `other`, with `{count}` filled. An own `count` in
 * `params` wins, so a caller can pass the number already formatted.
 */
export function pluralText(forms: PluralForms, count: number, lang: Lang, params?: TextParams): string {
  const picked = ownValue(forms, categoryOf(count, lang));
  const text = typeof picked === "string" ? picked : ownValue(forms, "other");
  return fillWith(typeof text === "string" ? text : "", params, count);
}

function categoryOf(count: number, lang: Lang): string {
  if (!NativePluralRules || !nativeSelect) return "other";
  let rules = RULES[lang];
  if (rules === undefined) {
    try {
      rules = new NativePluralRules(lang);
    } catch {
      rules = null;
    }
    RULES[lang] = rules;
  }
  return rules ? apply(nativeSelect, rules, [count]) : "other";
}

function fillWith(template: string, params: TextParams | undefined, count?: number): string {
  let result = "";
  let last = 0;
  for (let open = indexOf(template, "{"); open >= 0; open = indexOf(template, "{", open + 1)) {
    const close = indexOf(template, "}", open + 1);
    if (close < 0) break;
    const name = sliceOf(template, open + 1, close);
    if (!isName(name)) continue;
    let value = params === undefined ? undefined : ownValue(params, name);
    if (value === undefined && name === "count") value = count;
    if (typeof value !== "string" && typeof value !== "number") continue;
    result += sliceOf(template, last, open) + toText(value);
    last = close + 1;
    open = close;
  }
  return result + sliceOf(template, last);
}

function isName(name: string): boolean {
  if (name.length === 0) return false;
  for (let index = 0; index < name.length; index++) {
    // `| 32` folds ASCII capitals onto small letters and leaves every other code outside a-z.
    const code = charCodeAt(name, index) | 32;
    if (code < 97 || code > 122) return false;
  }
  return true;
}
