import { t } from "./i18n";
import { toProxyPath } from "./target";

export interface HistoryEntry {
  name: string;
  t: number;
}

const KEY = "girici:history";
const MAX = 100;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter(isVisit) : [];
  } catch {
    return [];
  }
}

/** A tile must open a site, so anything else in the store is left out. */
function isVisit(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const { name, t: time } = value as Partial<HistoryEntry>;
  return typeof name === "string" && typeof time === "number" && toProxyPath(name) !== null;
}

/** Prepend a visit, drop duplicates, cap the list, and persist it. */
export function rememberVisit(history: HistoryEntry[], name: string): HistoryEntry[] {
  const next = [{ name, t: Date.now() }, ...history.filter((entry) => entry.name !== name)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore a blocked store; the in-memory list still updates this session.
  }
  return next;
}

/** Drop one visit by name and persist the rest. */
export function removeVisit(history: HistoryEntry[], name: string): HistoryEntry[] {
  const next = history.filter((entry) => entry.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore a blocked store; the in-memory list still updates this session.
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do when storage is unavailable.
  }
}

/** Short relative age like "now", "5m", "2h", "3d". */
export function relativeTime(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return t("time.now");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("time.minutes", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("time.hours", { count: hours });
  return t("time.days", { count: Math.round(hours / 24) });
}
