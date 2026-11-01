import { openDB, type IDBPDatabase } from "idb";
import { labelSiteOf } from "../shared/label-site.ts";
import type { SiteConfigAnswer, SiteContext, SitePrefs, SiteReport } from "../shared/protocol.ts";
import { fromBase64Url, toBase64Url } from "../shared/seal-cipher.ts";
import { readSiteConfigAnswer } from "../shared/site-config.ts";
import {
  isSiteLabel,
  parseSiteDomain,
  SITE_LABEL_LENGTH,
  siteHostOrigin,
  siteLabel,
  type SiteDomain,
} from "../shared/site-label.ts";

// Not __g|-prefixed: the hooked IDBFactory never reaches it, and clearing site data keeps it.
const DATABASE = "__girici_site";
const STORE = "config";
const KEY = "answer";
const SINGLE = "single";
const HOST_MEMO_LIMIT = 512;

/** How long a navigation that needs the label key waits for a refresh to bring one. */
export const FIRST_KEY_WAIT_MS = 1000;
/** How long a page load waits for fresh settings before it goes on with the copy it has. */
export const PAGE_CONFIG_WAIT_MS = 500;

/** Subdomain mode as this host's worker sees it. */
export interface SiteState {
  domain: SiteDomain;
  /** The root's origin, where the UI and sign-in live. */
  root: string;
  label: string;
  /** Null until the gate would let this browser browse. */
  key: Uint8Array | null;
  prefs: SitePrefs;
  instanceSeal: boolean;
  deepLinkWarning: boolean;
}

export interface SiteStore {
  load(): Promise<unknown>;
  save(value: SiteConfigAnswer | "single"): Promise<void>;
}

export function createIdbSiteStore(): SiteStore {
  let database: Promise<IDBPDatabase> | null = null;
  const open = () => {
    database ??= openDB(DATABASE, 1, {
      upgrade: (db) => {
        db.createObjectStore(STORE);
      },
    }).catch((error: unknown) => {
      database = null;
      throw error;
    });
    return database;
  };
  return {
    load: async () => (await open()).get(STORE, KEY),
    save: async (value) => {
      await (await open()).put(STORE, value, KEY);
    },
  };
}

export interface SiteModeDeps {
  /** Calls this host's `SITES_CONFIG_PATH`. */
  fetch(init?: RequestInit): Promise<Response>;
  store: SiteStore;
  /** This worker's own `location.protocol` and `location.host`. */
  protocol: string;
  host: string;
  /** Hears every config the worker takes, stored or fresh. */
  apply?(state: SiteState): void | Promise<void>;
}

/** Reads subdomain mode from the server, keeps a copy across restarts and names each site's host. */
export class SiteModeService {
  readonly #deps: SiteModeDeps;
  /** The server serves this worker in subdomain mode only on a site host, so any other host is single-origin. */
  readonly #possible: boolean;
  #mode: "single" | "site" | null;
  #state: SiteState | null = null;
  #keyText: string | null = null;
  #ready: Promise<void> | null = null;
  #stored: Promise<boolean> | null = null;
  #inflight: Promise<void> | null = null;
  #asked = 0;
  #taken = 0;
  readonly #hosts = new Map<string, string>();
  #hostsFor = "";
  readonly #learned = new Set<string>();

  constructor(deps: SiteModeDeps) {
    this.#deps = deps;
    const dot = deps.host.indexOf(".");
    this.#possible = dot === SITE_LABEL_LENGTH && isSiteLabel(deps.host.slice(0, dot));
    this.#mode = this.#possible ? null : SINGLE;
  }

  /** The mode, once known; a host that cannot be a site host knows it from the start. */
  settled(): "single" | "site" | null {
    return this.#mode;
  }

  /** Null means single-origin mode, or a mode not known yet. */
  state(): SiteState | null {
    return this.#state;
  }

  /** The stored copy, else the server's answer. */
  ready(): Promise<void> {
    if (!this.#possible) return Promise.resolve();
    this.#ready ??= this.#loadOrFetch().catch((error: unknown) => {
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  /** Rejects only while no mode is known; `force` skips joining a refresh already under way. */
  refresh(force = false): Promise<void> {
    if (!this.#possible) return Promise.resolve();
    if (this.#inflight && !force) return this.#inflight;
    const run: Promise<void> = this.#fetchConfig().finally(() => {
      if (this.#inflight === run) this.#inflight = null;
    });
    this.#inflight = run;
    return run;
  }

  /** Never rejects, and never holds a page longer than `PAGE_CONFIG_WAIT_MS`. */
  forPage(): Promise<void> {
    return within(this.refresh(), PAGE_CONFIG_WAIT_MS);
  }

  async ensureKey(): Promise<boolean> {
    if (this.#state?.key) return true;
    await within(this.refresh(), FIRST_KEY_WAIT_MS);
    return !!this.#state?.key;
  }

  /** The origin of the host that serves `url`'s site, or null without a key. */
  hostOf(url: URL): string | null {
    const state = this.#state;
    if (!state?.key) return null;
    const site = labelSiteOf(url);
    let host = this.#hosts.get(site);
    if (host === undefined) {
      if (this.#hosts.size >= HOST_MEMO_LIMIT) this.#hosts.delete(this.#hosts.keys().next().value as string);
      host = siteHostOrigin(this.#deps.protocol, siteLabel(state.key, site), state.domain);
      this.#hosts.set(site, host);
    }
    return host;
  }

  context(target: URL): SiteContext | null {
    const state = this.#state;
    if (!state || this.#keyText === null) return null;
    return {
      domain: state.domain.value,
      root: state.root,
      label: state.label,
      key: this.#keyText,
      site: labelSiteOf(target),
      toolbar: state.prefs.toolbar,
      engine: state.prefs.engine,
    };
  }

  /** Tells the server once per worker life, so the root can list the site for clearing. */
  learnSite(site: string): void {
    if (this.#learned.has(site)) return;
    this.#learned.add(site);
    const report: SiteReport = { site };
    const forget = () => void this.#learned.delete(site);
    this.#deps
      .fetch({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
        cache: "no-store",
      })
      .then((response) => {
        if (!response.ok) forget();
      }, forget);
  }

  async #loadOrFetch(): Promise<void> {
    if (await this.#loadStored()) return;
    await this.refresh(true);
  }

  async #fetchConfig(): Promise<void> {
    const asked = ++this.#asked;
    let answer: SiteConfigAnswer | typeof SINGLE | null = null;
    try {
      const response = await this.#deps.fetch({ cache: "no-store" });
      if (response.status === 404) answer = SINGLE;
      else if (response.ok) answer = readSiteConfigAnswer(await response.json());
    } catch {
      // Unreadable or offline: the copy already held stays.
    }
    const state = answer === null || answer === SINGLE ? null : this.#stateOf(answer);
    if (answer === SINGLE || state) {
      if (asked < this.#taken) return;
      this.#taken = asked;
      await this.#take(state);
      this.#deps.store.save(answer === SINGLE ? SINGLE : (answer as SiteConfigAnswer)).catch(() => {});
      return;
    }
    if (this.#mode === null && !(await this.#loadStored())) {
      throw new Error("Girici could not read this host's site config");
    }
  }

  #loadStored(): Promise<boolean> {
    this.#stored ??= this.#readStore();
    return this.#stored;
  }

  async #readStore(): Promise<boolean> {
    let value: unknown;
    try {
      value = await this.#deps.store.load();
    } catch {
      this.#stored = null;
      return this.#mode !== null;
    }
    // A fresh answer that arrived meanwhile wins over the copy.
    if (this.#mode !== null) return true;
    if (value === SINGLE) {
      await this.#take(null);
      return true;
    }
    const answer = readSiteConfigAnswer(value);
    const state = answer && this.#stateOf(answer);
    if (!state) return false;
    await this.#take(state);
    return true;
  }

  /** Null for an answer meant for another host, which would place every site wrongly. */
  #stateOf(answer: SiteConfigAnswer): SiteState | null {
    const domain = parseSiteDomain(answer.domain);
    if (!domain || `${answer.label}.${domain.value}` !== this.#deps.host) return null;
    const key = answer.key === null ? null : fromBase64Url(answer.key);
    return {
      domain,
      root: `${this.#deps.protocol}//${domain.value}`,
      label: answer.label,
      key,
      prefs: { ...answer.prefs },
      instanceSeal: answer.instanceSeal,
      deepLinkWarning: answer.deepLinkWarning,
    };
  }

  async #take(state: SiteState | null): Promise<void> {
    this.#mode = state ? "site" : SINGLE;
    this.#state = state;
    this.#keyText = state?.key ? toBase64Url(state.key) : null;
    const hostsFor = state?.key ? `${this.#keyText}|${state.domain.value}` : "";
    if (hostsFor !== this.#hostsFor) {
      this.#hosts.clear();
      this.#hostsFor = hostsFor;
    }
    if (state) await this.#deps.apply?.(state);
  }
}

/** Waits for `work` at most `ms`, and swallows its failure. */
function within(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  return Promise.race([work.catch(() => {}), timeout]).finally(() => clearTimeout(timer));
}
