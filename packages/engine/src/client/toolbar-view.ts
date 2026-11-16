import type { Catalogs } from "../shared/i18n/catalog.ts";
import { toolbarText as es } from "./locales/es.ts";
import { toolbarText as ptBR } from "./locales/pt-BR.ts";
import { toolbarText as fr } from "./locales/fr.ts";
import { toolbarText as de } from "./locales/de.ts";
import { toolbarText as ru } from "./locales/ru.ts";
import { toolbarText as fa } from "./locales/fa.ts";
import { toolbarText as ar } from "./locales/ar.ts";
import { toolbarText as zhCN } from "./locales/zh-CN.ts";
import { toolbarText as id } from "./locales/id.ts";
import { toolbarText as vi } from "./locales/vi.ts";

/** The Girici mark from girici-icon-white.svg, without its metadata block. */
const MARK =
  '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M30 6A26 26 0 1 0 55.3 38H44.83A16 16 0 1 1 30 16Z"/><rect width="38" height="8" x="24" y="26"/></svg>';

const icon = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

const BACK = icon("M15 18l-6-6 6-6");
const FORWARD = icon("M9 18l6-6-6-6");
const RELOAD = icon("M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4");
const TRASH = icon("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13");
const CLOSE = icon("M6 6l12 12M18 6L6 18");

const button = (action: string, label: string, content: string) =>
  `<button type="button" data-action="${action}" aria-label="${label}" title="${label}">${content}</button>`;

export interface ToolbarText {
  toolbar: string;
  home: string;
  back: string;
  forward: string;
  reload: string;
  address: string;
  clearSite: string;
  hide: string;
  clear: string;
  cancel: string;
  confirmClear: string;
  clearing: string;
  clearFailed: string;
}

/** Plain text with no markup characters, since it goes into attributes and the shadow root as written. */
export const TOOLBAR_TEXT: Catalogs<ToolbarText> = {
  en: {
    toolbar: "Girici toolbar",
    home: "Girici home",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    address: "Address",
    clearSite: "Clear site data",
    hide: "Hide toolbar",
    clear: "Clear",
    cancel: "Cancel",
    confirmClear: "Clear cookies and storage for this site?",
    clearing: "Clearing…",
    clearFailed: "Could not clear this site.",
  },
  tr: {
    toolbar: "Girici araç çubuğu",
    home: "Girici ana sayfası",
    back: "Geri",
    forward: "İleri",
    reload: "Yenile",
    address: "Adres",
    clearSite: "Site verilerini temizle",
    hide: "Araç çubuğunu gizle",
    clear: "Temizle",
    cancel: "Vazgeç",
    confirmClear: "Bu sitenin çerezleri ve depolanan verileri silinsin mi?",
    clearing: "Temizleniyor…",
    clearFailed: "Bu sitenin verileri temizlenemedi.",
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

/** Static markup only: no URLs, so nothing in it depends on the page's rewriting. */
export function toolbarHtml(text: ToolbarText, dir: "ltr" | "rtl" = "ltr"): string {
  return `<button class="handle" type="button" aria-label="${text.toolbar}">${MARK}</button>
<div class="panel" role="toolbar" aria-label="Girici" dir="${dir}" hidden>
${button("home", text.home, MARK)}${button("back", text.back, BACK)}${button("forward", text.forward, FORWARD)}${button("reload", text.reload, RELOAD)}
<input class="address" type="text" dir="ltr" aria-label="${text.address}" spellcheck="false" autocomplete="off" autocapitalize="off">
${button("clear", text.clearSite, TRASH)}${button("hide", text.hide, CLOSE)}
</div>
<div class="panel confirm" role="group" aria-label="${text.clearSite}" dir="${dir}" hidden>
<span class="message"></span>
<button class="text danger" type="button" data-action="confirm-clear">${text.clear}</button>
<button class="text" type="button" data-action="cancel-clear">${text.cancel}</button>
</div>`;
}

export const TOOLBAR_CSS = `
:host { all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483647; color: #fafafa;
  font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; }
[hidden] { display: none !important; }
button { all: unset; box-sizing: border-box; display: grid; place-items: center; flex: none; width: 32px; height: 32px;
  border-radius: 8px; color: #a1a1aa; cursor: pointer; }
button:hover { color: #fafafa; background: #27272a; }
button:focus-visible, .address:focus-visible { outline: 2px solid #3d6bff; outline-offset: 1px; }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;
  stroke-linejoin: round; }
svg.mark { fill: currentColor; stroke: none; }
.handle { border-radius: 50%; background: #0a0f1e; border: 1px solid #27272a; color: #fafafa;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%); }
.panel { display: flex; align-items: center; gap: 2px; box-sizing: border-box; height: 40px;
  width: min(560px, calc(100vw - 24px)); padding: 0 4px; background: #0a0f1e; border: 1px solid #27272a;
  border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / 40%); }
.address { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: 8px;
  background: #18181b; color: #fafafa; font: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.address[aria-invalid="true"] { box-shadow: inset 0 0 0 1px #f87171; }
.message { flex: 1; min-width: 0; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button.text { width: auto; padding: 0 10px; color: #fafafa; }
button.danger { color: #f87171; }
@media print { :host { display: none; } }
`;
