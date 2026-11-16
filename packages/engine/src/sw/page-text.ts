import type { Catalogs } from "../shared/i18n/catalog.ts";
import type { PluralForms } from "../shared/i18n/text.ts";
import type { RelayErrorCode } from "../shared/protocol.ts";

/** A runtime that failed verification, or an address this browser cannot open, is not a relay error. */
export type ErrorPageCode = RelayErrorCode | "runtime" | "sealed";

/** The texts of the pages the service worker writes itself. Each `{host}` and `{wait}` is filled in at render time. */
export interface PageText {
  errors: Record<ErrorPageCode, string>;
  /** Stands in for `{host}` when the page has no target. */
  someSite: string;
  backHome: string;
  waitLater: string;
  waitMinute: string;
  waitMinutes: PluralForms;
  waitHours: PluralForms;
  warningTitle: string;
  warningBody: string;
  warningContinue: string;
  warningHome: string;
}

const en: PageText = {
  errors: {
    ssrf_blocked: "Girici does not open local or private network addresses.",
    dns: "Girici could not find {host}.",
    connect: "Girici could not connect to {host}.",
    tls: "{host} sent an invalid certificate.",
    timeout: "{host} took too long to respond.",
    too_large: "The request is too large.",
    bad_request: "This address cannot be opened through Girici.",
    header_overflow: "{host} sent headers that are too large.",
    auth: "Girici needs you to sign in before opening {host}.",
    rate_limited: "Too many requests from your network. Wait a moment, then reload.",
    blocked: "{host} is blocked on this Girici server.",
    proxy: "Girici's upstream proxy could not reach {host}.",
    quota: "Your network has used up its data allowance on this Girici server. Try again {wait}.",
    challenge: "Girici needs to check this browser before it opens {host}. Reload the page.",
    runtime:
      "Girici could not verify its page script. If a CDN or proxy in front of this server rewrites or minifies JavaScript, turn that off for /_g/.",
    sealed:
      "This address was sealed in another browser, or this browser's address key was reset. Open the site again from Girici.",
  },
  someSite: "the site",
  backHome: "Back to Girici",
  waitLater: "later",
  waitMinute: "in a minute",
  waitMinutes: { one: "in {count} minute", other: "in {count} minutes" },
  waitHours: { one: "in {count} hour", other: "in {count} hours" },
  warningTitle: "This page opens through Girici",
  warningBody:
    "Girici is a web proxy. The next page comes from {host}, not from the people who run this server. Do not type passwords into a site you did not mean to visit.",
  warningContinue: "Continue to {host}",
  warningHome: "Go to Girici's home page",
};

const tr: PageText = {
  errors: {
    ssrf_blocked: "Girici yerel ya da özel ağ adreslerini açmaz.",
    dns: "Girici {host} adresini bulamadı.",
    connect: "Girici {host} adresine bağlanamadı.",
    tls: "{host} geçersiz bir sertifika gönderdi.",
    timeout: "{host} zamanında yanıt vermedi.",
    too_large: "İstek çok büyük.",
    bad_request: "Bu adres Girici üzerinden açılamıyor.",
    header_overflow: "{host} çok büyük başlıklar gönderdi.",
    auth: "{host} adresini açmak için önce Girici'de oturum açmalısınız.",
    rate_limited: "Ağınızdan çok fazla istek geldi. Biraz bekleyip sayfayı yenileyin.",
    blocked: "{host} bu Girici sunucusunda engellenmiş.",
    proxy: "Girici'nin bağlandığı üst proxy {host} adresine ulaşamadı.",
    quota: "Ağınız bu Girici sunucusundaki veri kotasını doldurdu. Lütfen {wait} yeniden deneyin.",
    challenge: "Girici'nin {host} adresini açmadan önce bu tarayıcıyı doğrulaması gerekiyor. Sayfayı yenileyin.",
    runtime:
      "Girici sayfa betiğini doğrulayamadı. Bu sunucunun önündeki bir CDN ya da proxy JavaScript'i değiştiriyor veya küçültüyorsa /_g/ için bunu kapatın.",
    sealed:
      "Bu adres başka bir tarayıcıda şifrelenmiş ya da bu tarayıcının adres anahtarı sıfırlanmış. Siteyi Girici'den yeniden açın.",
  },
  someSite: "site",
  backHome: "Girici'ye dön",
  waitLater: "daha sonra",
  waitMinute: "bir dakika sonra",
  waitMinutes: { other: "{count} dakika sonra" },
  waitHours: { other: "{count} saat sonra" },
  warningTitle: "Bu sayfa Girici üzerinden açılıyor",
  warningBody:
    "Girici bir web proxy'sidir. Açılacak sayfa bu sunucuyu işletenlerden değil, {host} adresinden geliyor. Girmeyi düşünmediğiniz bir sitede parolanızı yazmayın.",
  warningContinue: "{host} adresine devam et",
  warningHome: "Girici ana sayfasına git",
};

export const PAGE_TEXT: Catalogs<PageText> = { en, tr };
