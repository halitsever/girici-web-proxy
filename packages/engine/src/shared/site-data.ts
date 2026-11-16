import { domainMatches } from "./cookie-mirror.ts";
import { opfsPartition, partitionOrigin, partitionTop } from "./partition.ts";

/** The part of Storage used here; the service worker build compiles this folder without DOM types. */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

/** What captureSiteDataEnv reads from a window. */
export interface StorageRealm {
  localStorage?: KeyValueStore;
  sessionStorage?: KeyValueStore;
  indexedDB?: IDBFactory;
  IDBFactory?: { prototype: IDBFactory };
  caches?: CacheStorage;
  CacheStorage?: { prototype: CacheStorage };
  navigator?: { storage?: { getDirectory?(): Promise<OpfsDirectory> } };
}

/** The part of an origin private file system folder used here, typed by hand for the service worker build. */
export interface OpfsDirectory {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** The storage a window can reach; a proxied page captures these before its own hooks wrap them. */
export interface SiteDataEnv {
  local: KeyValueStore | null;
  session: KeyValueStore | null;
  databaseNames(): Promise<string[]>;
  deleteDatabase(name: string): Promise<void>;
  cacheNames(): Promise<string[]>;
  deleteCache(name: string): Promise<void>;
  /** Names in the root of the origin private file system. */
  folderNames?(): Promise<string[]>;
  deleteFolder?(name: string): Promise<void>;
}

/** Binds the native functions now, so a realm can capture them before its storage isolation is installed. */
export function captureSiteDataEnv(win: StorageRealm): SiteDataEnv {
  const idb = attempt(() => win.indexedDB);
  const databases = win.IDBFactory?.prototype.databases;
  const deleteDatabase = win.IDBFactory?.prototype.deleteDatabase;
  const caches = attempt(() => win.caches);
  const cacheKeys = win.CacheStorage?.prototype.keys;
  const cacheDelete = win.CacheStorage?.prototype.delete;
  const storage = attempt(() => win.navigator?.storage);
  // Bound now: a page's own getDirectory is swapped for its partition's folder later.
  const getDirectory = storage?.getDirectory;
  const root = async () => (storage && getDirectory ? getDirectory.call(storage) : null);
  return {
    local: attempt(() => win.localStorage),
    session: attempt(() => win.sessionStorage),
    databaseNames: async () => {
      if (!idb || !databases) return [];
      const list = await databases.call(idb);
      return list.map((db) => db.name).filter((name): name is string => typeof name === "string");
    },
    deleteDatabase: (name) =>
      new Promise<void>((resolve) => {
        if (!idb || !deleteDatabase) {
          resolve();
          return;
        }
        const request = deleteDatabase.call(idb, name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        // A delete blocked by another tab finishes once that tab closes its connection.
        request.onblocked = () => resolve();
      }),
    cacheNames: async () => (caches && cacheKeys ? cacheKeys.call(caches) : []),
    deleteCache: async (name) => {
      if (caches && cacheDelete) await cacheDelete.call(caches, name);
    },
    folderNames: async () => {
      const folder = await root();
      const names: string[] = [];
      if (folder) for await (const name of folder.keys()) names.push(name);
      return names;
    },
    deleteFolder: async (name) => {
      await (await root())?.removeEntry(name, { recursive: true });
    },
  };
}

export async function partitionOrigins(env: SiteDataEnv): Promise<string[]> {
  const { storage, named } = await allNames(env);
  const origins = new Set<string>();
  for (const name of [...storage, ...named]) {
    const origin = partitionOrigin(name);
    if (origin) origins.add(origin);
  }
  return [...origins].sort();
}

/**
 * Deletes the partitions of a site and its subdomains, or every partition when site is null. A site's copies inside
 * other sites go too, and so do the copies other sites keep while embedded in it.
 */
export async function clearPartitions(env: SiteDataEnv, site: string | null): Promise<void> {
  const belongs = (origin: string | null) => {
    if (origin === null || site === null) return false;
    try {
      return domainMatches(new URL(origin).hostname, site);
    } catch {
      // An unknown top ("null") belongs to no site.
      return false;
    }
  };
  const matches = (name: string) =>
    partitionOrigin(name) !== null && (site === null || belongs(partitionOrigin(name)) || belongs(partitionTop(name)));
  for (const storage of [env.local, env.session]) {
    for (const key of keysOf(storage)) if (matches(key)) storage?.removeItem(key);
  }
  for (const name of await listOrEmpty(env.databaseNames)) if (matches(name)) await env.deleteDatabase(name);
  for (const name of await listOrEmpty(env.cacheNames)) if (matches(name)) await env.deleteCache(name);
  for (const folder of await listOrEmpty(env.folderNames)) {
    const name = opfsPartition(folder);
    if (name !== null && matches(name)) await attemptAsync(() => env.deleteFolder?.(folder));
  }
}

async function allNames(env: SiteDataEnv): Promise<{ storage: string[]; named: string[] }> {
  const folders = (await listOrEmpty(env.folderNames)).map(opfsPartition).filter((name) => name !== null);
  return {
    storage: [...keysOf(env.local), ...keysOf(env.session)],
    named: [...(await listOrEmpty(env.databaseNames)), ...(await listOrEmpty(env.cacheNames)), ...folders],
  };
}

function keysOf(storage: KeyValueStore | null): string[] {
  const keys: string[] = [];
  if (!storage) return keys;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/** A private window can refuse to enumerate databases; that store then has nothing to clear. */
async function listOrEmpty(list: (() => Promise<string[]>) | undefined): Promise<string[]> {
  try {
    return list ? await list() : [];
  } catch {
    return [];
  }
}

/** A file still open in a worker cannot be removed; the rest of the site's data is cleared all the same. */
async function attemptAsync(run: () => Promise<void> | undefined): Promise<void> {
  try {
    await run();
  } catch {
    // Left for the next clear.
  }
}

function attempt<T>(read: () => T | undefined): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}
