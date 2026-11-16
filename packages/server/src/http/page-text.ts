import { parseAcceptLanguage, pickLanguage, textFor, type Catalogs, type Lang } from "@girici/engine/shared";
import type { Request } from "express";

/** Plain text, since the HTML pages place it as written. */
export interface ServerText {
  starting: string;
  needsScript: string;
  notActive: string;
  freshPost: string;
  sealedGone: string;
  clearing: string;
}

export const SERVER_TEXT: Catalogs<ServerText> = {
  en: {
    starting: "Starting Girici...",
    needsScript: "Girici needs JavaScript.",
    notActive: "Girici is not active in this tab. Reload the page.",
    freshPost: "Girici has not opened this site in this browser yet. Open the site once, then send the form again.",
    sealedGone:
      "Addresses encrypted before this server moved sites to their own addresses do not open any more. " +
      "Open the site again from Girici.",
    clearing: "Clearing site data…",
  },
  tr: {
    starting: "Girici başlatılıyor...",
    needsScript: "Girici için JavaScript gerekiyor.",
    notActive: "Girici bu sekmede etkin değil. Sayfayı yenileyin.",
    freshPost: "Girici bu siteyi bu tarayıcıda henüz açmadı. Siteyi bir kez açın, ardından formu yeniden gönderin.",
    sealedGone:
      "Bu sunucu siteleri kendi adreslerine taşımadan önce şifrelenen adresler artık açılmıyor. " +
      "Siteyi Girici'den yeniden açın.",
    clearing: "Site verileri temizleniyor…",
  },
};

/**
 * The server cannot see the UI's language setting, which lives in the browser, so it goes by Accept-Language unless
 * the caller has the setting from a cookie.
 */
export function requestLang(req: Request, choice?: unknown): Lang {
  return pickLanguage(SERVER_TEXT, choice, parseAcceptLanguage(req.get("accept-language")));
}

export function serverText(lang: Lang): ServerText {
  return textFor(SERVER_TEXT, lang);
}
