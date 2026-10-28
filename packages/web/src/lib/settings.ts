import type { SearchEngine } from "./target";

export interface Settings {
  engine: SearchEngine;
  newTab: boolean;
  rememberHistory: boolean;
  blockCookies: boolean;
}

const KEY = "girici:settings";
const DEFAULTS: Settings = { engine: "DuckDuckGo", newTab: false, rememberHistory: true, blockCookies: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A private window with storage blocked keeps the defaults for this session.
  }
}
