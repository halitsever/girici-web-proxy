import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANG,
  directionOf,
  isLang,
  LANGUAGES,
  negotiateLanguage,
  parseAcceptLanguage,
} from "../src/shared/i18n/languages.ts";
import { fill, pluralText } from "../src/shared/i18n/text.ts";
import { REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const RUSSIAN_FILES = { one: "{count} файл", few: "{count} файла", many: "{count} файлов", other: "{count} файла" };

describe("languages", () => {
  it("lists twelve languages with Arabic and Persian right to left", () => {
    expect(LANGUAGES.map((info) => [info.code, info.name, info.dir])).toEqual([
      ["en", "English", "ltr"],
      ["tr", "Türkçe", "ltr"],
      ["es", "Español", "ltr"],
      ["pt-BR", "Português (Brasil)", "ltr"],
      ["fr", "Français", "ltr"],
      ["de", "Deutsch", "ltr"],
      ["ru", "Русский", "ltr"],
      ["fa", "فارسی", "rtl"],
      ["ar", "العربية", "rtl"],
      ["zh-CN", "简体中文", "ltr"],
      ["id", "Bahasa Indonesia", "ltr"],
      ["vi", "Tiếng Việt", "ltr"],
    ]);
    expect(DEFAULT_LANG).toBe("en");
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("fa")).toBe("rtl");
    expect(directionOf("zh-CN")).toBe("ltr");
  });

  it("knows only the exact codes", () => {
    expect(LANGUAGES.every((info) => isLang(info.code))).toBe(true);
    for (const value of ["pt-br", "pt", "zh", "auto", "", "__proto__", "toString", 5, null, undefined]) {
      expect(isLang(value), String(value)).toBe(false);
    }
  });

  it("negotiates regional and unknown languages", () => {
    expect(negotiateLanguage(["tr-TR", "en"])).toBe("tr");
    expect(negotiateLanguage(["PT-pt"])).toBe("pt-BR");
    expect(negotiateLanguage(["zh-TW"])).toBe("zh-CN");
    expect(negotiateLanguage(["es-419"])).toBe("es");
    expect(negotiateLanguage(["in"])).toBe("id");
    expect(negotiateLanguage(["ja", "it"])).toBe("en");
    expect(negotiateLanguage(["ja", "fa-IR"])).toBe("fa");
    expect(negotiateLanguage([])).toBe("en");
    expect(negotiateLanguage(["zh-hant-tw"])).toBe("zh-CN");
    expect(negotiateLanguage(["EN-gb", "de"])).toBe("en");
    expect(negotiateLanguage(["pt-br"])).toBe("pt-BR");
  });

  it("orders an Accept-Language header by weight", () => {
    expect(parseAcceptLanguage("tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7")).toEqual(["tr-TR", "tr", "en-US", "en"]);
    expect(parseAcceptLanguage("fr;q=0, de, *;q=0.5")).toEqual(["de"]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage("en;q=0.5, fa, ar;Q=0.9, de;q=0.5")).toEqual(["fa", "ar", "en", "de"]);
  });

  it("drops malformed and oversized ranges and keeps at most twenty", () => {
    expect(parseAcceptLanguage("de;q=x, fr;q=2, , e<n, it;q=0.3")).toEqual(["it"]);
    expect(parseAcceptLanguage(`${"a".repeat(36)}, ${"b".repeat(35)}`)).toEqual(["b".repeat(35)]);
    const many = Array.from({ length: 30 }, (_, index) => `x${index}`);
    expect(parseAcceptLanguage(many.join(","))).toEqual(many.slice(0, 20));
  });
});

describe("text", () => {
  it("fills placeholders from own properties only", () => {
    expect(fill("Open {host}", { host: "a.test" })).toBe("Open a.test");
    expect(fill("{missing} and {count}", { count: 3 })).toBe("{missing} and 3");
    expect(fill("Hello {name}")).toBe("Hello {name}");
    expect(fill("{a-b} {1} { x } {x", { x: "y" })).toBe("{a-b} {1} { x } {x");
    expect(fill("{{x}}", { x: "y" })).toBe("{y}");
    expect(withPrototypeAdditions({ host: { value: "page", writable: true } }, () => fill("Open {host}", {}))).toBe(
      "Open {host}",
    );
  });

  it("picks plural forms by language", () => {
    expect(pluralText(RUSSIAN_FILES, 1, "ru")).toBe("1 файл");
    expect(pluralText(RUSSIAN_FILES, 3, "ru")).toBe("3 файла");
    expect(pluralText(RUSSIAN_FILES, 5, "ru")).toBe("5 файлов");
    expect(pluralText({ one: "{count} cookie", other: "{count} cookies" }, 1, "en")).toBe("1 cookie");
    expect(pluralText({ one: "{count} cookie", other: "{count} cookies" }, 0, "en")).toBe("0 cookies");
  });

  it("falls back to the other form and fills the remaining placeholders", () => {
    expect(pluralText({ other: "{count} sites on {host}" }, 1, "en", { host: "a.test" })).toBe("1 sites on a.test");
    expect(pluralText({ one: "one", other: "{count}" }, 3, "ar")).toBe("3");
    expect(pluralText({ one: "{count} site", other: "{count} sites" }, 1200, "en", { count: "1,200" })).toBe(
      "1,200 sites",
    );
    const page = { few: { value: "page", writable: true } };
    expect(withPrototypeAdditions(page, () => pluralText({ one: "{count} x", other: "{count} y" }, 3, "ru"))).toBe(
      "3 y",
    );
  });

  it("negotiates and fills whatever the page replaced", () => {
    const run = () => [
      negotiateLanguage(["ja", "PT-pt"]),
      negotiateLanguage(["zh-TW"]),
      parseAcceptLanguage("tr-TR,tr;q=0.9, en;q=0.7, *;q=0.1"),
      fill("Open {host}", { host: "a.test" }),
      pluralText(RUSSIAN_FILES, 5, "ru"),
      isLang("fa"),
      directionOf("ar"),
    ];
    const expected = run();
    const replaced: typeof REPLACED_BUILTINS = [
      ...REPLACED_BUILTINS,
      ["String.prototype.toLowerCase", String.prototype, "toLowerCase", { value: () => "en" }],
      ["String.prototype.split", String.prototype, "split", { value: () => [] }],
      ["String.prototype.trim", String.prototype, "trim", { value: () => "*" }],
      ["Array.prototype[Symbol.iterator]", Array.prototype, Symbol.iterator, { value: function* () {} }],
      ["Array.prototype.push", Array.prototype, "push", { value: () => 0 }],
      ["Intl.PluralRules.prototype.select", Intl.PluralRules.prototype, "select", { value: () => "one" }],
    ];
    for (const [name, target, key, replacement] of replaced) {
      expect(withReplaced(target, key, replacement, run), name).toEqual(expected);
    }
  });
});
