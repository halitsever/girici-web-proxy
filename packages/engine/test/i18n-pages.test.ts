import { describe, expect, it } from "vitest";
import { BOOT_TEXT } from "../src/boot/text.ts";
import { TOOLBAR_TEXT, toolbarHtml } from "../src/client/toolbar-view.ts";
import { isLangChoice, pickLanguage, textFor, type Catalogs } from "../src/shared/i18n/catalog.ts";
import { DEFAULT_ENGINE_PREFS, type EnginePrefs } from "../src/shared/protocol.ts";
import { DeepLinkWarning } from "../src/sw/deep-link-warning.ts";
import { errorPage, waitText } from "../src/sw/error-page.ts";
import { PAGE_TEXT } from "../src/sw/page-text.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const SHIPPED: Catalogs<string> = { en: "English", tr: "Türkçe" };

describe("pickLanguage", () => {
  it("takes the UI's choice when a catalog covers it", () => {
    expect(pickLanguage(SHIPPED, "tr", ["en-US"])).toBe("tr");
    expect(pickLanguage(SHIPPED, "en", ["tr-TR"])).toBe("en");
  });

  it("follows the browser on auto, skipping languages without a catalog", () => {
    expect(pickLanguage(SHIPPED, "auto", ["tr-TR", "en"])).toBe("tr");
    expect(pickLanguage(SHIPPED, "auto", ["de-DE", "tr"])).toBe("tr");
    expect(pickLanguage(SHIPPED, "auto", ["en-GB", "tr"])).toBe("en");
    expect(pickLanguage(SHIPPED, "auto", ["ja", "it"])).toBe("en");
    expect(pickLanguage(SHIPPED, "de", ["tr"])).toBe("tr");
    expect(pickLanguage(SHIPPED, undefined, [])).toBe("en");
  });

  it("reads only real choices", () => {
    expect(isLangChoice("auto")).toBe(true);
    expect(isLangChoice("tr")).toBe(true);
    expect(isLangChoice("tr-TR")).toBe(false);
    expect(isLangChoice("__proto__")).toBe(false);
  });

  it("falls back to English text for a language nobody translated", () => {
    expect(textFor(SHIPPED, "de")).toBe("English");
    expect(textFor(SHIPPED, "tr")).toBe("Türkçe");
  });

  it("picks the same while a page has replaced built-ins", () => {
    const run = () => [pickLanguage(SHIPPED, "auto", ["de-DE", "tr"]), pickLanguage(SHIPPED, "auto", ["EN-us"])];
    const expected = run();
    expect(expected).toEqual(["tr", "en"]);
    for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, key, replacement, run), name).toEqual(expected);
    }
  });
});

describe("Turkish pages", () => {
  it("writes the error page in Turkish with the host and wait filled in", () => {
    const page = errorPage("quota", new URL("https://a.test/"), 120, "/", "tr");
    expect(page).toContain('<html lang="tr">');
    expect(page).toContain("veri kotasını doldurdu. Lütfen 2 dakika sonra yeniden deneyin.");
    expect(page).toContain("Girici'ye dön");
    expect(errorPage("connect", null, undefined, "/", "tr")).toContain("Girici site adresine bağlanamadı.");
    expect(waitText(7200, "tr")).toBe("2 saat sonra");
    expect(waitText(undefined, "tr")).toBe("daha sonra");
  });

  it("keeps English for a language without a catalog", () => {
    expect(errorPage("dns", new URL("https://a.test/"), undefined, "/", "de")).toContain(
      "Girici could not find a.test.",
    );
  });

  it("writes the shared-link warning in Turkish", async () => {
    let prefs: EnginePrefs = { ...DEFAULT_ENGINE_PREFS };
    const warning = new DeepLinkWarning({
      prefs: {
        ready: async () => {},
        current: () => prefs,
        set: async (update) => void (prefs = { ...prefs, ...update }),
      },
      instance: { deepLinkWarning: async () => true },
      keys: { load: async () => null, loadOrCreate: async (fresh) => fresh() },
    });
    const html = await (await warning.page("/~/https/site-a.test/", new URL("https://site-a.test/"), "/", "tr")).text();
    expect(html).toContain('<html lang="tr">');
    expect(html).toContain("<h1>Bu sayfa Girici üzerinden açılıyor</h1>");
    expect(html).toContain("site-a.test adresine devam et");
  });

  it("labels the toolbar in Turkish", () => {
    const html = toolbarHtml(textFor(TOOLBAR_TEXT, "tr"));
    expect(html).toContain('aria-label="Girici araç çubuğu"');
    expect(html).toContain('aria-label="Site verilerini temizle"');
    expect(html).toContain(">Vazgeç</button>");
  });

  it("keeps markup characters out of every text that goes into HTML as written", () => {
    for (const catalog of [TOOLBAR_TEXT, BOOT_TEXT]) {
      for (const text of [catalog.en, catalog.tr]) {
        for (const value of Object.values(text ?? {})) expect(value).not.toMatch(/[<>&"]/);
      }
    }
    expect(Object.keys(PAGE_TEXT.tr?.errors ?? {}).sort()).toEqual(Object.keys(PAGE_TEXT.en.errors).sort());
  });
});
