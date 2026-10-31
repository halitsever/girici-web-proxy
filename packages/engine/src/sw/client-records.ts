import { openDB, type IDBPDatabase } from "idb";

// Not __g|-prefixed, so clearing site data never touches it.
const DATABASE = "__girici_clients";
const STORES = ["ui", "workers"] as const;

export type ClientRecordKind = (typeof STORES)[number];

/** What the worker knows about its clients, kept where it survives the browser stopping the worker. */
export interface ClientRecordStore {
  load(store: ClientRecordKind): Promise<Array<{ key: string; value: unknown }>>;
  put(store: ClientRecordKind, key: string, value: unknown): Promise<void>;
  delete(store: ClientRecordKind, key: string): Promise<void>;
}

export function createIdbClientRecords(): ClientRecordStore {
  let database: Promise<IDBPDatabase> | null = null;
  const open = () => {
    database ??= openDB(DATABASE, 1, {
      upgrade: (db) => {
        for (const store of STORES) db.createObjectStore(store);
      },
    }).catch((error: unknown) => {
      // A failed open is retried on the next call rather than remembered forever.
      database = null;
      throw error;
    });
    return database;
  };
  return {
    async load(store) {
      const transaction = (await open()).transaction(store);
      const [keys, values] = await Promise.all([transaction.store.getAllKeys(), transaction.store.getAll()]);
      return keys.map((key, index) => ({ key: String(key), value: values[index] as unknown }));
    },
    async put(store, key, value) {
      await (await open()).put(store, value, key);
    },
    async delete(store, key) {
      await (await open()).delete(store, key);
    },
  };
}
