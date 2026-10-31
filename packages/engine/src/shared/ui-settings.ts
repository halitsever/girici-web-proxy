import { ownValue, parseJson } from "./primordials.ts";
import { SEARCH_ENGINES, type SearchEngine } from "./target.ts";

/** The Girici UI keeps its settings here; proxied pages read the toolbar choice from the same key. */
export const UI_SETTINGS_KEY = "girici:settings";

export function readToolbarPrefs(raw: string | null): { toolbar: boolean; engine: SearchEngine } {
  const prefs = { __proto__: null, toolbar: true, engine: "DuckDuckGo" } as { toolbar: boolean; engine: SearchEngine };
  let saved: unknown;
  try {
    // The toolbar reads this inside renewal, on page calls, so only natives taken at load and own fields count.
    saved = parseJson(raw ?? "null");
  } catch {
    return prefs;
  }
  if (typeof saved !== "object" || saved === null) return prefs;
  const toolbar = ownValue(saved, "toolbar");
  const engine = ownValue(saved, "engine");
  if (typeof toolbar === "boolean") prefs.toolbar = toolbar;
  if (typeof engine === "string" && ownValue(SEARCH_ENGINES, engine) !== undefined)
    prefs.engine = engine as SearchEngine;
  return prefs;
}
