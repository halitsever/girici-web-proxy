/** Readers for subdomain-mode values that arrive from outside: they run beside page code, so only own fields count. */

import { bytesLength, ownValue } from "./primordials.ts";
import {
  DEFAULT_SITE_PREFS,
  MESSAGE_ENVELOPE,
  type MessageEnvelope,
  type SiteConfigAnswer,
  type SitePrefs,
} from "./protocol.ts";
import { fromBase64Url } from "./seal-cipher.ts";
import { isSiteLabel, parseSiteDomain } from "./site-label.ts";
import { SEARCH_ENGINES, type SearchEngine } from "./target.ts";

const FLAGS = ["blockThirdPartyCookies", "sealAddresses", "toolbar", "seen"] as const;
const LABEL_KEY_BYTES = 32;

/** Each missing or malformed field takes its default, so a damaged cookie still leaves the secure settings. */
export function readSitePrefs(value: unknown): SitePrefs {
  const prefs = { __proto__: null, ...DEFAULT_SITE_PREFS } as SitePrefs;
  if (typeof value !== "object" || value === null) return prefs;
  for (let index = 0; index < FLAGS.length; index++) {
    const name = FLAGS[index] as (typeof FLAGS)[number];
    const flag = ownValue(value, name);
    if (typeof flag === "boolean") prefs[name] = flag;
  }
  const engine = ownValue(value, "engine");
  if (typeof engine === "string" && ownValue(SEARCH_ENGINES, engine) !== undefined) {
    prefs.engine = engine as SearchEngine;
  }
  return prefs;
}

export function readSiteConfigAnswer(value: unknown): SiteConfigAnswer | null {
  if (typeof value !== "object" || value === null) return null;
  const domain = ownValue(value, "domain");
  const label = ownValue(value, "label");
  const key = ownValue(value, "key");
  const instanceSeal = ownValue(value, "instanceSeal");
  const deepLinkWarning = ownValue(value, "deepLinkWarning");
  if (ownValue(value, "v") !== 1 || typeof domain !== "string" || typeof label !== "string") return null;
  if (parseSiteDomain(domain)?.value !== domain || !isSiteLabel(label) || typeof instanceSeal !== "boolean") {
    return null;
  }
  if (typeof deepLinkWarning !== "boolean") return null;
  if (key !== null && !isLabelKey(key)) return null;
  return {
    __proto__: null,
    v: 1,
    domain,
    label,
    key,
    prefs: readSitePrefs(ownValue(value, "prefs")),
    instanceSeal,
    deepLinkWarning,
  } as SiteConfigAnswer;
}

/** Null unless `value` carries the envelope mark and its origin fields as its own. */
export function readMessageEnvelope(value: unknown): MessageEnvelope | null {
  if (typeof value !== "object" || value === null || ownValue(value, MESSAGE_ENVELOPE) !== 1) return null;
  const o = ownValue(value, "o");
  const s = ownValue(value, "s");
  const t = ownValue(value, "t");
  if (typeof o !== "string" || typeof s !== "string" || typeof t !== "string") return null;
  return { __proto__: null, [MESSAGE_ENVELOPE]: 1, o, s, t, d: ownValue(value, "d") } as MessageEnvelope;
}

function isLabelKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const bytes = fromBase64Url(key);
  return bytes !== null && bytesLength(bytes) === LABEL_KEY_BYTES;
}
