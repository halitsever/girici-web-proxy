import { UI_SETTINGS_KEY } from "@girici/engine/shared";
import type { SearchEngine } from "./target";

export interface Settings {
  engine: SearchEngine;
  newTab: boolean;
  rememberHistory: boolean;
  blockCookies: boolean;
  toolbar: boolean;
}

const DEFAULTS: Settings = {
  engine: "DuckDuckGo",
  newTab: false,
  rememberHistory: true,
  blockCookies: true,
  toolbar: true,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
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
