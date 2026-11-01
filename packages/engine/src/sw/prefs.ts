import { openDB, type IDBPDatabase } from "idb";
import { DEFAULT_ENGINE_PREFS, PREFS_MESSAGE, PROTOCOL_VERSION, type EnginePrefs } from "../shared/protocol.ts";
import { isUiWindow, type ClientShape, type UiClientSet } from "./route.ts";

// Not __g|-prefixed, so clearing site data never touches it.
const DATABASE = "__girici_prefs";
const STORE = "prefs";
const KEY = "engine";

export interface PrefsRecordStore {
  load(): Promise<unknown>;
  save(value: EnginePrefs): Promise<void>;
}

export function createIdbPrefsStore(): PrefsRecordStore {
  let database: Promise<IDBPDatabase> | null = null;
  const open = () => {
    database ??= openDB(DATABASE, 1, {
      upgrade: (db) => {
        db.createObjectStore(STORE);
      },
    }).catch((error: unknown) => {
      // A failed open is retried on the next call rather than remembered forever.
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

/** The UI's choices as the worker last heard them; it survives worker restarts through its own store. */
export class PrefsService {
  readonly #store: PrefsRecordStore;
  #current: EnginePrefs = { ...DEFAULT_ENGINE_PREFS };
  #loaded: Promise<void> | null = null;

  constructor(store: PrefsRecordStore) {
    this.#store = store;
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  current(): EnginePrefs {
    return { ...this.#current };
  }

  async set(update: Partial<EnginePrefs>): Promise<void> {
    await this.ready();
    this.#current = { ...this.#current, ...update };
    try {
      await this.#store.save(this.#current);
    } catch {
      // The choice still holds in memory until the worker restarts.
    }
  }

  async #load(): Promise<void> {
    try {
      const value = (await this.#store.load()) as Record<string, unknown> | undefined;
      if (typeof value?.blockThirdPartyCookies === "boolean") {
        this.#current = { ...DEFAULT_ENGINE_PREFS, ...booleanPrefs(value) };
      }
    } catch {
      // A broken store leaves the defaults.
    }
  }
}

const PREF_NAMES = ["blockThirdPartyCookies", "sealAddresses", "instanceSeal", "seen"] as const;
/** UI pages allowed to say seen. The UI says it only when the visitor opens a site, never when a page loads. */
const SEEN_PAGES = new Set(["/", "/settings", "/account"]);

function booleanPrefs(value: Record<string, unknown>): Partial<EnginePrefs> {
  const prefs: Partial<EnginePrefs> = {};
  for (const name of PREF_NAMES) {
    const field = value[name];
    if (typeof field === "boolean") prefs[name] = field;
  }
  return prefs;
}

/** Only the Girici UI may change these; a proxied page or its worker posting the same message is ignored. */
export function readPrefsMessage(
  data: unknown,
  source: ClientShape | null,
  origin: string,
  ui: UiClientSet,
): Partial<EnginePrefs> | null {
  if (typeof data !== "object" || data === null || !isUiWindow(source, origin, ui)) return null;
  const fields = data as Record<string, unknown>;
  const { type, v, blockThirdPartyCookies } = fields;
  if (type !== PREFS_MESSAGE || v !== PROTOCOL_VERSION || typeof blockThirdPartyCookies !== "boolean") return null;
  const update = booleanPrefs(fields);
  // Any UI window can post; only the server's answer turns the admin's switch off.
  if (update.instanceSeal === false) delete update.instanceSeal;
  if (update.seen === false || !SEEN_PAGES.has(pageOf(source))) delete update.seen;
  return update;
}

/** Normalized as isUiRoute does, since the server answers these paths in any letter case. */
function pageOf(source: ClientShape | null): string {
  try {
    return new URL(source?.url ?? "").pathname.toLowerCase().replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
}
