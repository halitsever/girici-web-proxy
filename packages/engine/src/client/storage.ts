import { prefixFor, sameSite } from "../shared/partition.ts";
import { originOf, type Realm } from "./url-context.ts";

export { prefixFor };

// Taken at load, before page code can replace them, because some run lazily on the page's first storage access.
const apply = Reflect.apply;
const toText = String;
const create = Object.create;
const protoOf = Object.getPrototypeOf;
const describe = Object.getOwnPropertyDescriptor;
const startsWith = String.prototype.startsWith;
const slice = String.prototype.slice;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;

/** Where a window's storage lives: its own origin's, or for a frame of another site, a copy kept per top origin. */
export function partitionFor(input: {
  origin: string;
  isTop: boolean;
  topUrl: URL | null;
  site: string | undefined;
}): string {
  const { origin, isTop, topUrl, site } = input;
  if (isTop || (topUrl && site !== undefined && sameSite(topUrl, site))) return prefixFor(origin);
  return prefixFor(origin, topUrl ? originOf(topUrl) : "null");
}

export interface StorageMethods {
  length: (this: Storage) => number;
  key: Storage["key"];
  getItem: Storage["getItem"];
  setItem: Storage["setItem"];
  removeItem: Storage["removeItem"];
}

/** Taken before page code runs: a replaced Storage.prototype method would otherwise receive the raw store. */
export function storageMethods(proto: object): StorageMethods {
  const own = (name: string) => describe(proto, name);
  return {
    length: own("length")?.get as StorageMethods["length"],
    key: own("key")?.value as Storage["key"],
    getItem: own("getItem")?.value as Storage["getItem"],
    setItem: own("setItem")?.value as Storage["setItem"],
    removeItem: own("removeItem")?.value as Storage["removeItem"],
  };
}

/** Every proxied site shares our origin's storage, so each real origin gets its own key prefix. */
export function createPartitionedStorage(
  native: Storage,
  prefix: string,
  calls: StorageMethods = storageMethods(protoOf(native) as object),
): Storage {
  const length = () => apply(calls.length, native, []);
  const nativeKey = (index: number) => apply(calls.key, native, [index]);
  const getItem = (key: string) => apply(calls.getItem, native, [key]);
  const setItem = (key: string, value: string) => apply(calls.setItem, native, [key, value]);
  const removeItem = (key: string) => apply(calls.removeItem, native, [key]);
  const keys = (): string[] => {
    const found: string[] = [];
    for (let index = 0; index < length(); index++) {
      const key = nativeKey(index);
      if (key !== null && apply(startsWith, key, [prefix])) found.push(apply(slice, key, [prefix.length]) as string);
    }
    return found;
  };
  const methods: Record<string, unknown> = {
    getItem: (key: unknown) => getItem(prefix + toText(key)),
    setItem: (key: unknown, value: unknown) => setItem(prefix + toText(key), toText(value)),
    removeItem: (key: unknown) => removeItem(prefix + toText(key)),
    clear: () => {
      for (const key of keys()) removeItem(prefix + key);
    },
    key: (index: number) => keys()[index] ?? null,
  };
  // Sharing the native prototype keeps `instanceof Storage` true for the page.
  const target = create(protoOf(native) as object) as Storage;
  const proto = protoOf(target) as object;

  // A null prototype keeps traps a page adds to Object.prototype out of this handler.
  return new Proxy(target, {
    __proto__: null,
    get: (_target, property, receiver) => {
      if (typeof property === "symbol") return Reflect.get(target, property, receiver);
      if (property === "length") return keys().length;
      if (property in methods) return methods[property];
      if (property in proto) return Reflect.get(target, property, receiver);
      return getItem(prefix + property) ?? undefined;
    },
    set: (_target, property, value) => {
      if (typeof property === "symbol") return false;
      setItem(prefix + property, toText(value));
      return true;
    },
    deleteProperty: (_target, property) => {
      if (typeof property === "string") removeItem(prefix + property);
      return true;
    },
    has: (_target, property) =>
      typeof property === "string" &&
      (property in methods || property === "length" || getItem(prefix + property) !== null),
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property !== "string") return undefined;
      const value = getItem(prefix + property);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty: (_target, property, descriptor) => {
      if (typeof property === "string" && "value" in descriptor) setItem(prefix + property, toText(descriptor.value));
      return true;
    },
  } as ProxyHandler<Storage>);
}

export function installStorage(win: Realm, partition: () => string): void {
  const storageProto = (win as unknown as { Storage?: { prototype: object } }).Storage?.prototype;
  const calls = storageProto ? storageMethods(storageProto) : undefined;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const getNative = findGetter(win, name);
    if (!getNative) continue;
    // One object per partition keeps `localStorage === localStorage` true.
    const byPartition = new Map<string, Storage>();
    Object.defineProperty(win, name, {
      configurable: true,
      enumerable: true,
      get: () => {
        const prefix = partition();
        let storage = apply(mapGet, byPartition, [prefix]) as Storage | undefined;
        if (!storage) {
          storage = createPartitionedStorage(apply(getNative, win, []) as Storage, prefix, calls);
          apply(mapSet, byPartition, [prefix, storage]);
        }
        return storage;
      },
    });
  }
}

function findGetter(object: object, name: string): ((this: unknown) => unknown) | undefined {
  for (let current: object | null = object; current; current = Object.getPrototypeOf(current) as object | null) {
    const get = Object.getOwnPropertyDescriptor(current, name)?.get;
    if (get) return get;
  }
  return undefined;
}
