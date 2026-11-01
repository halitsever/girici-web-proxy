import { escapeAttribute, isSiteLabel } from "@girici/engine/shared";
import type { SiteKeys } from "./keys.ts";
import { openValue, signValue } from "./signed.ts";

/** Which hosts to clear, in order; `https` picks the visited cookie's name at the end of the chain. */
export interface ClearPlan {
  labels: string[];
  sites: string[];
  https: boolean;
  exp: number;
}

export const PLAN_TTL_MS = 600_000;

const PURPOSE = "clear";

/** The plan as a query string, `p=<plan>&s=<signature>`; both parts are base64url, so nothing needs escaping. */
export function signPlan(plan: ClearPlan, keys: SiteKeys): string {
  const [p, s] = signValue(keys.clear, PURPOSE, plan).split(".");
  return `p=${p}&s=${s}`;
}

export function openPlan(p: string, s: string, keys: SiteKeys, now = Date.now()): ClearPlan | null {
  const value = openValue(keys.clear, PURPOSE, `${p}.${s}`);
  if (typeof value !== "object" || value === null) return null;
  const { labels, sites, https, exp } = value as Record<string, unknown>;
  if (!isStringList(labels) || !isStringList(sites) || labels.length !== sites.length) return null;
  if (!labels.every(isSiteLabel) || typeof https !== "boolean" || typeof exp !== "number" || exp < now) return null;
  return { labels, sites, https, exp };
}

/** A top-level page, since WebKit ignores Clear-Site-Data on a frame; it moves on to `next` at once. */
export function clearPage(next: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=${escapeAttribute(next)}" />
    <title>Girici</title>
  </head>
  <body>
    <p>Clearing site data…</p>
  </body>
</html>
`;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
