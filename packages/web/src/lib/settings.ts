import { isLang, UI_SETTINGS_KEY, type Lang } from "@girici/engine/shared";
import type { SearchEngine } from "./target";

export interface Settings {
  engine: SearchEngine;
  newTab: boolean;
  rememberHistory: boolean;
  blockCookies: boolean;
  toolbar: boolean;
  sealAddresses: boolean;
  /** "auto" follows the browser's languages. */
  lang: Lang | "auto";
}

const DEFAULTS: Settings = {
  engine: "DuckDuckGo",
  newTab: false,
  rememberHistory: true,
  blockCookies: true,
  toolbar: true,
  sealAddresses: false,
  lang: "auto",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    const settings = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
    if (settings.lang !== "auto" && !isLang(settings.lang)) settings.lang = "auto";
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A private window with storage blocked keeps the defaults for this session.
  }
}
