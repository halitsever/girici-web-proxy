import { afterEach, describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { renderToString } from "vue/server-renderer";
import { en } from "@/locales/en";
import { tr } from "@/locales/tr";
import LoginView from "@/views/Login/LoginView.vue";
import { relativeTime } from "../history";
import { applyLanguageToDocument, lang, setLanguage, t, tn, UI_LANGUAGES } from "../i18n";
import { clearedNote } from "../site-data";
import { limitText } from "../status";

afterEach(() => {
  setLanguage("en", []);
});

/** The distinct `{name}`s in a text or its plural forms, sorted, so two languages can be compared. */
function placeholders(value: unknown): string[] {
  return [...new Set([...JSON.stringify(value).matchAll(/\{([a-z]+)\}/gi)].map((match) => match[1]!))].sort();
}

describe("UI language", () => {
  it("starts in English and follows the setting or the browser", () => {
    expect(lang.value).toBe("en");
    expect(setLanguage("auto", ["tr-TR", "en-US"])).toBe("tr");
    expect(setLanguage("auto", ["de-DE", "en"])).toBe("en");
    expect(setLanguage("tr", ["en-US"])).toBe("tr");
    expect(setLanguage("de", ["tr"])).toBe("tr");
  });

  it("offers only the languages it has text for", () => {
    expect(UI_LANGUAGES.map((info) => info.code)).toEqual(["en", "tr"]);
  });

  it("keeps the same keys and placeholders in Turkish", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(tr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("sets the document's language and direction", () => {
    const root = { lang: "", dir: "" };
    applyLanguageToDocument("tr", root);
    expect(root).toEqual({ lang: "tr", dir: "ltr" });
  });

  it("writes texts, counts and library messages in Turkish", () => {
    setLanguage("tr", []);
    expect(t("browse.opening", { name: "example.com" })).toBe("example.com açılıyor…");
    expect(tn("sites.cookies", 1)).toBe("1 çerez");
    expect(clearedNote("3")).toBe("3 sitenin verileri temizlendi.");
    expect(limitText(1_048_576, "day")).toBe("ziyaretçi başına günde 1 MB");
    expect(relativeTime(0, 5 * 60_000)).toBe("5 dk");
    setLanguage("en", []);
    expect(tn("sites.cookies", 2)).toBe("2 cookies");
    expect(clearedNote("1")).toBe("Cleared 1 site.");
  });

  it("renders the sign-in page in Turkish", async () => {
    setLanguage("tr", []);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: LoginView }] });
    await router.push("/");
    await router.isReady();
    const html = await renderToString(createSSRApp(LoginView).use(router));
    expect(html).toContain("Girici için giriş yapın");
    expect(html).toContain("Kullanıcı adı");
    expect(html).toContain("Giriş yap");
    expect(html).toContain("Kaynak kodu · AGPL-3.0");
    expect(html).not.toContain("Sign in");
  });
});
