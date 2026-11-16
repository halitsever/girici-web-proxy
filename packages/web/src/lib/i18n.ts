import {
  DEFAULT_LANG,
  directionOf,
  fill,
  LANGUAGES,
  pickLanguage,
  pluralText,
  textFor,
  type Catalogs,
  type Lang,
  type LangChoice,
  type PluralForms,
  type TextParams,
} from "@girici/engine/shared";
import { ref } from "vue";
import { en, type Messages } from "@/locales/en";
import { tr } from "@/locales/tr";

const CATALOGS: Catalogs<Messages> = { en, tr };

type KeyOf<T> = { [K in keyof Messages]: Messages[K] extends T ? K : never }[keyof Messages];
export type TextKey = KeyOf<string>;
export type PluralKey = KeyOf<PluralForms>;

/** The languages the UI has text for, as the Settings picker lists them. */
export const UI_LANGUAGES = LANGUAGES.filter((info) => CATALOGS[info.code] !== undefined);

/** English until main.ts applies the saved choice, so code that never does, tests included, reads English. */
export const lang = ref<Lang>(DEFAULT_LANG);

export function setLanguage(choice: LangChoice, ranges: readonly string[]): Lang {
  lang.value = pickLanguage(CATALOGS, choice, ranges);
  return lang.value;
}

/** Keeps the page's lang and dir in step, for screen readers and hyphenation. */
export function applyLanguageToDocument(next: Lang, root: Pick<HTMLElement, "lang" | "dir">): void {
  root.lang = next;
  root.dir = directionOf(next);
}

/** Reading `lang` here makes every template that calls it render again when the language changes. */
export function t(key: TextKey, params?: TextParams): string {
  const text = textFor(CATALOGS, lang.value)[key];
  return params ? fill(text, params) : text;
}

export function tn(key: PluralKey, count: number, params?: TextParams): string {
  return pluralText(textFor(CATALOGS, lang.value)[key], count, lang.value, params);
}
