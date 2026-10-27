import { openDB, type IDBPDatabase } from "idb";
import type { CookieRecordStore } from "./jar.ts";

const DATABASE = "__girici";
const STORE = "cookies";

/** The browser stops idle service workers, so the jar is kept where it survives them. */
export function createIdbCookieStore(): CookieRecordStore {
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
    async loadAll() {
      const transaction = (await open()).transaction(STORE);
      const [keys, values] = await Promise.all([transaction.store.getAllKeys(), transaction.store.getAll()]);
      return keys.map((key, index) => ({ key: String(key), value: values[index] as unknown }));
    },
    async write(puts, deletes) {
      const transaction = (await open()).transaction(STORE, "readwrite");
      await Promise.all([
        ...puts.map(({ key, value }) => transaction.store.put(value, key)),
        ...deletes.map((key) => transaction.store.delete(key)),
        transaction.done,
      ]);
    },
  };
}
