import { prefixFor, sameSite } from "../shared/partition.ts";
import { append, define, originOf, parseUrl } from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentListeners } from "./renewal.ts";
import type { Realm } from "./url-context.ts";

export { prefixFor };

// Taken at load, before page code can replace them, because some run lazily on the page's first storage access.
const apply = Reflect.apply;
const toText = String;
const create = Object.create;
const protoOf = Object.getPrototypeOf;
const describe = Object.getOwnPropertyDescriptor;
const startsWith = String.prototype.startsWith;
const slice = String.prototype.slice;
const NativeMap = Map;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;

/**
 * Where a window's storage lives: its own origin's, or for a frame of another site, a copy kept per top origin. The
 * site comes from a renewable config, so it counts only when the frame's own host belongs to it and the top's
 * runtime, when it can be asked, holds the same site.
 */
export function partitionFor(input: {
  origin: string;
  isTop: boolean;
  topUrl: URL | null;
  site: string | undefined;
  topSite?: string | undefined;
}): string {
  const { origin, isTop, topUrl, site, topSite } = input;
  if (isTop) return prefixFor(origin);
  const own = parseUrl(origin);
  const firstParty =
    topUrl !== null &&
    own !== null &&
    site !== undefined &&
    sameSite(topUrl, site) &&
    sameSite(own, site) &&
    (topSite === undefined || topSite === site);
  return firstParty ? prefixFor(origin) : prefixFor(origin, topUrl ? originOf(topUrl) : "null");
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

/** Returns the storage event filter, whose listener a document step adds again after document.open drops it. */
export function installStorage(win: Realm, partition: () => string): DocumentListeners {
  const storageProto = (win as unknown as { Storage?: { prototype: object } }).Storage?.prototype;
  const calls = storageProto ? storageMethods(storageProto) : undefined;
  const areas: Array<[() => unknown, () => Storage]> = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const getNative = findGetter(win, name);
    if (!getNative) continue;
    // One object per partition keeps `localStorage === localStorage` true.
    const byPartition = new NativeMap<string, Storage>();
    const get = () => {
      const prefix = partition();
      let storage = apply(mapGet, byPartition, [prefix]) as Storage | undefined;
      if (!storage) {
        storage = createPartitionedStorage(apply(getNative, win, []) as Storage, prefix, calls);
        apply(mapSet, byPartition, [prefix, storage]);
      }
      return storage;
    };
    append(areas, [() => apply(getNative, win, []), get]);
    define(win, name, { configurable: true, enumerable: true, get });
  }
  const partitioned = (native: unknown): unknown => {
    for (let index = 0; index < areas.length; index++) {
      const area = areas[index] as [() => unknown, () => Storage];
      if (area[0]() === native) return area[1]();
    }
    return null;
  };
  return installStorageEvents(win, partition, partitioned);
}

/** Storage events reach every window of our origin, so a window sees only its own partition's changes, unprefixed. */
function installStorageEvents(
  win: Realm,
  partition: () => string,
  partitioned: (native: unknown) => unknown,
): DocumentListeners {
  const proto = (win as unknown as { StorageEvent?: { prototype: object } }).StorageEvent?.prototype;
  const getters = proto && {
    key: describe(proto, "key")?.get,
    oldValue: describe(proto, "oldValue")?.get,
    newValue: describe(proto, "newValue")?.get,
    storageArea: describe(proto, "storageArea")?.get,
  };
  const stop = win.Event.prototype.stopImmediatePropagation;
  const addListener = win.addEventListener;
  if (!proto || !getters?.key) return { listen: () => {} };
  const nativeKey = getters.key;
  // isTrusted is an own, unforgeable property of each event; one a page made itself is left as it made it.
  const trusted = (event: unknown) => (event as Event).isTrusted === true;
  const ownKey = (event: unknown): string | null => {
    const key: unknown = apply(nativeKey, event, []);
    if (typeof key !== "string") return null;
    const prefix = partition();
    return apply(startsWith, key, [prefix]) ? (apply(slice, key, [prefix.length]) as string) : null;
  };
  const hook = (name: keyof typeof getters, read: (event: unknown, native: () => unknown) => unknown) => {
    const get = getters[name];
    const descriptor = describe(proto, name);
    if (!get || !descriptor) return;
    define(proto, name, {
      ...descriptor,
      get: maskNative(function (this: unknown) {
        const native = () => apply(get, this, []);
        return trusted(this) ? read(this, native) : native();
      }, get),
    });
  };
  hook("key", (event) => ownKey(event));
  hook("oldValue", (event, native) => (ownKey(event) === null ? null : native()));
  hook("newValue", (event, native) => (ownKey(event) === null ? null : native()));
  hook("storageArea", (_event, native) => partitioned(native()));
  const drop = (event: unknown) => {
    if (trusted(event) && ownKey(event) === null) apply(stop, event, []);
  };
  // Capture on the window, added before any page listener, so it runs first.
  return { listen: () => apply(addListener, win, ["storage", drop, true]) };
}

function findGetter(object: object, name: string): ((this: unknown) => unknown) | undefined {
  for (let current: object | null = object; current; current = Object.getPrototypeOf(current) as object | null) {
    const get = Object.getOwnPropertyDescriptor(current, name)?.get;
    if (get) return get;
  }
  return undefined;
}
