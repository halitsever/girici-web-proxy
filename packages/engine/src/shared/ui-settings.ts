import { SEARCH_ENGINES, type SearchEngine } from "./target.ts";

/** The Girici UI keeps its settings here; proxied pages read the toolbar choice from the same key. */
export const UI_SETTINGS_KEY = "girici:settings";

export function readToolbarPrefs(raw: string | null): { toolbar: boolean; engine: SearchEngine } {
  const prefs: { toolbar: boolean; engine: SearchEngine } = { toolbar: true, engine: "DuckDuckGo" };
  let saved: unknown;
  try {
    saved = JSON.parse(raw ?? "null");
  } catch {
    return prefs;
  }
  if (typeof saved !== "object" || saved === null) return prefs;
  const { toolbar, engine } = saved as { toolbar?: unknown; engine?: unknown };
  if (typeof toolbar === "boolean") prefs.toolbar = toolbar;
  if (typeof engine === "string" && Object.hasOwn(SEARCH_ENGINES, engine)) prefs.engine = engine as SearchEngine;
  return prefs;
}
