import { openDB, type IDBPDatabase } from "idb";
import { decodeUrl } from "../shared/codec.ts";
import { PROTOCOL_VERSION, SEAL_MESSAGE } from "../shared/protocol.ts";
import { MasterSealer, type OpenSealed } from "../shared/sealed-address.ts";
import type { PrefsService } from "./prefs.ts";
import { isUiWindow, type ClientShape, type UiClientSet } from "./route.ts";

// Not __g|-prefixed: the hooked IDBFactory never reaches it, and clearing site data keeps it.
const DATABASE = "__girici_keys";
const STORE = "keys";
const KEY_BYTES = 32;

export interface KeyStore {
  load(): Promise<Uint8Array | null>;
  loadOrCreate(fresh: () => Uint8Array): Promise<Uint8Array>;
}

/** Each use keeps its own key under its own name, so no key serves two purposes. */
export function createIdbKeyStore(name = "address"): KeyStore {
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
    load: async () => validKey(await (await open()).get(STORE, name)),
    // One transaction, so two workers starting at once cannot each write a different key.
    loadOrCreate: async (fresh) => {
      const transaction = (await open()).transaction(STORE, "readwrite");
      const stored = validKey(await transaction.store.get(name));
      if (stored) return stored;
      const key = fresh();
      await transaction.store.put(key, name);
      await transaction.done;
      return key;
    },
  };
}

function validKey(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array && value.length === KEY_BYTES ? value : null;
}

const randomKey = () => crypto.getRandomValues(new Uint8Array(KEY_BYTES));

/** This browser's address key and the switches that decide when new addresses get sealed. */
export class Sealing {
  readonly #keys: KeyStore;
  readonly #prefs: Pick<PrefsService, "ready" | "current">;
  readonly #random: () => Uint8Array;
  #master: MasterSealer | null = null;
  #loaded: Promise<void> | null = null;
  #creating: Promise<MasterSealer | null> | null = null;

  constructor(keys: KeyStore, prefs: Pick<PrefsService, "ready" | "current">, random: () => Uint8Array = randomKey) {
    this.#keys = keys;
    this.#prefs = prefs;
    this.#random = random;
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  enabled(): boolean {
    const prefs = this.#prefs.current();
    return prefs.sealAddresses || prefs.instanceSeal;
  }

  readonly open: OpenSealed = (pathAndQuery) => this.#master?.open(pathAndQuery) ?? null;

  /** Opening never depends on the switch: a sealed request gets the stored key while sealing is off. */
  async sealerFor(sealedRequest: boolean): Promise<MasterSealer | null> {
    await this.ready();
    if (!this.enabled()) return sealedRequest ? this.#master : null;
    if (this.#master) return this.#master;
    this.#creating ??= this.#create();
    return this.#creating;
  }

  /** The address the UI should open for a plain proxy path, or null for a path that is not one. */
  async addressFor(path: string): Promise<string | null> {
    const target = decodeUrl(path);
    if (!target) return null;
    const sealer = await this.sealerFor(false);
    return sealer ? sealer.seal(target) : path;
  }

  async #load(): Promise<void> {
    await this.#prefs.ready();
    try {
      const key = await this.#keys.load();
      if (key && !this.#master) this.#master = new MasterSealer(key);
    } catch {
      // The next request reads the store again, so sealed addresses open once it answers.
      this.#loaded = null;
    }
  }

  async #create(): Promise<MasterSealer | null> {
    try {
      this.#master ??= new MasterSealer(await this.#keys.loadOrCreate(this.#random));
    } catch {
      // Without a stored key a sealed address would not open after the worker restarts, so pages stay plain.
    } finally {
      this.#creating = null;
    }
    return this.#master;
  }
}

/** Only a Girici UI window may ask; a page could otherwise learn the token of any site it names. */
export function readSealMessage(
  data: unknown,
  source: ClientShape | null,
  origin: string,
  ui: UiClientSet,
): string | null {
  if (typeof data !== "object" || data === null || !isUiWindow(source, origin, ui)) return null;
  const { type, v, path } = data as Record<string, unknown>;
  return type === SEAL_MESSAGE && v === PROTOCOL_VERSION && typeof path === "string" ? path : null;
}
