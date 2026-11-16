import type { Catalogs } from "../shared/i18n/catalog.ts";
import { bootText as es } from "./locales/es.ts";
import { bootText as ptBR } from "./locales/pt-BR.ts";
import { bootText as fr } from "./locales/fr.ts";
import { bootText as de } from "./locales/de.ts";
import { bootText as ru } from "./locales/ru.ts";
import { bootText as fa } from "./locales/fa.ts";
import { bootText as ar } from "./locales/ar.ts";
import { bootText as zhCN } from "./locales/zh-CN.ts";
import { bootText as id } from "./locales/id.ts";
import { bootText as vi } from "./locales/vi.ts";

export interface BootText {
  noWorker: string;
  noControl: string;
  /** `{error}` is the browser's own message, in the browser's language. */
  failed: string;
}

export const BOOT_TEXT: Catalogs<BootText> = {
  en: {
    noWorker: "This browser cannot run Girici here. Service workers need HTTPS or localhost.",
    noControl: "Girici could not take control of this tab. Reload to try again.",
    failed: "Girici could not start: {error}",
  },
  tr: {
    noWorker: "Bu tarayıcı Girici'yi burada çalıştıramıyor. Service worker için HTTPS ya da localhost gerekiyor.",
    noControl: "Girici bu sekmenin denetimini alamadı. Yeniden denemek için sayfayı yenileyin.",
    failed: "Girici başlatılamadı: {error}",
  },
  es,
  "pt-BR": ptBR,
  fr,
  de,
  ru,
  fa,
  ar,
  "zh-CN": zhCN,
  id,
  vi,
};
