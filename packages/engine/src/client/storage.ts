import { prefixFor } from "../shared/partition.ts";
import type { Realm, UrlContext } from "./url-context.ts";

export { prefixFor };

const apply = Reflect.apply;
const toText = String;

export interface StorageMethods {
  length: (this: Storage) => number;
  key: Storage["key"];
  getItem: Storage["getItem"];
  setItem: Storage["setItem"];
  removeItem: Storage["removeItem"];
}

/** Taken before page code runs: a replaced Storage.prototype method would otherwise receive the raw store. */
export function storageMethods(proto: object): StorageMethods {
  const own = (name: string) => Object.getOwnPropertyDescriptor(proto, name);
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
  origin: string,
  calls: StorageMethods = storageMethods(Object.getPrototypeOf(native) as object),
): Storage {
  const prefix = prefixFor(origin);
  const length = () => apply(calls.length, native, []);
  const nativeKey = (index: number) => apply(calls.key, native, [index]);
  const getItem = (key: string) => apply(calls.getItem, native, [key]);
  const setItem = (key: string, value: string) => apply(calls.setItem, native, [key, value]);
  const removeItem = (key: string) => apply(calls.removeItem, native, [key]);
  const keys = (): string[] => {
    const found: string[] = [];
    for (let index = 0; index < length(); index++) {
      const key = nativeKey(index);
      if (key?.startsWith(prefix)) found.push(key.slice(prefix.length));
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
  const target = Object.create(Object.getPrototypeOf(native) as object) as Storage;
  const proto = Object.getPrototypeOf(target) as object;

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

export function installStorage(win: Realm, ctx: UrlContext): void {
  const storageProto = (win as unknown as { Storage?: { prototype: object } }).Storage?.prototype;
  const calls = storageProto ? storageMethods(storageProto) : undefined;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const getNative = findGetter(win, name);
    if (!getNative) continue;
    // One object per origin keeps `localStorage === localStorage` true.
    const byOrigin = new Map<string, Storage>();
    Object.defineProperty(win, name, {
      configurable: true,
      enumerable: true,
      get: () => {
        const origin = ctx.realUrl().origin;
        let storage = byOrigin.get(origin);
        if (!storage) {
          storage = createPartitionedStorage(apply(getNative, win, []) as Storage, origin, calls);
          byOrigin.set(origin, storage);
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
