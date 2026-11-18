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

/** Every language but English loads when chosen, so a visitor downloads one catalog, not a dozen. */
const LOADERS: { readonly [L in Exclude<Lang, "en">]?: () => Promise<Messages> } = {
  tr: () => import("@/locales/tr").then((module) => module.tr),
  es: () => import("@/locales/es").then((module) => module.es),
  "pt-BR": () => import("@/locales/pt-BR").then((module) => module.ptBR),
  fr: () => import("@/locales/fr").then((module) => module.fr),
  de: () => import("@/locales/de").then((module) => module.de),
  ru: () => import("@/locales/ru").then((module) => module.ru),
  fa: () => import("@/locales/fa").then((module) => module.fa),
  ar: () => import("@/locales/ar").then((module) => module.ar),
  "zh-CN": () => import("@/locales/zh-CN").then((module) => module.zhCN),
  id: () => import("@/locales/id").then((module) => module.id),
  vi: () => import("@/locales/vi").then((module) => module.vi),
};

const AVAILABLE: Catalogs<true> = { en: true, ...Object.fromEntries(Object.keys(LOADERS).map((code) => [code, true])) };
const CATALOGS: { en: Messages } & { [L in Lang]?: Messages } = { en };

type KeyOf<T> = { [K in keyof Messages]: Messages[K] extends T ? K : never }[keyof Messages];
export type TextKey = KeyOf<string>;
export type PluralKey = KeyOf<PluralForms>;

/** The languages the UI has text for, as the Settings picker lists them. */
export const UI_LANGUAGES = LANGUAGES.filter((info) => AVAILABLE[info.code] !== undefined);

/** English until main.ts applies the saved choice, so code that never does, tests included, reads English. */
export const lang = ref<Lang>(DEFAULT_LANG);

let latest = 0;

/** Switches once the language's text has loaded; the page stays in its current language until then, or if it fails. */
export async function setLanguage(choice: LangChoice, ranges: readonly string[]): Promise<Lang> {
  const ask = ++latest;
  const next = pickLanguage(AVAILABLE, choice, ranges);
  const load = next === "en" ? undefined : LOADERS[next];
  if (load && !CATALOGS[next]) {
    try {
      CATALOGS[next] = await load();
    } catch {
      return lang.value;
    }
  }
  // A choice made while this one loaded wins.
  if (ask === latest) lang.value = next;
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
