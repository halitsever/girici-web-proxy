import type { Catalogs } from "../shared/i18n/catalog.ts";

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
};
