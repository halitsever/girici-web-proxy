import { prefixFor } from "../shared/partition.ts";
import type { Realm, UrlContext } from "./url-context.ts";

export { prefixFor };

/** Every proxied site shares our origin's storage, so each real origin gets its own key prefix. */
export function createPartitionedStorage(native: Storage, origin: string): Storage {
  const prefix = prefixFor(origin);
  const keys = (): string[] => {
    const found: string[] = [];
    for (let index = 0; index < native.length; index++) {
      const key = native.key(index);
      if (key?.startsWith(prefix)) found.push(key.slice(prefix.length));
    }
    return found;
  };
  const methods: Record<string, unknown> = {
    getItem: (key: unknown) => native.getItem(prefix + String(key)),
    setItem: (key: unknown, value: unknown) => native.setItem(prefix + String(key), String(value)),
    removeItem: (key: unknown) => native.removeItem(prefix + String(key)),
    clear: () => {
      for (const key of keys()) native.removeItem(prefix + key);
    },
    key: (index: number) => keys()[index] ?? null,
  };
  // Sharing the native prototype keeps `instanceof Storage` true for the page.
  const target = Object.create(Object.getPrototypeOf(native) as object) as Storage;
  const proto = Object.getPrototypeOf(target) as object;

  return new Proxy(target, {
    get: (_target, property, receiver) => {
      if (typeof property === "symbol") return Reflect.get(target, property, receiver);
      if (property === "length") return keys().length;
      if (property in methods) return methods[property];
      if (property in proto) return Reflect.get(target, property, receiver);
      return native.getItem(prefix + property) ?? undefined;
    },
    set: (_target, property, value) => {
      if (typeof property === "symbol") return false;
      native.setItem(prefix + property, String(value));
      return true;
    },
    deleteProperty: (_target, property) => {
      if (typeof property === "string") native.removeItem(prefix + property);
      return true;
    },
    has: (_target, property) =>
      typeof property === "string" &&
      (property in methods || property === "length" || native.getItem(prefix + property) !== null),
    ownKeys: () => keys(),
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property !== "string") return undefined;
      const value = native.getItem(prefix + property);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
    defineProperty: (_target, property, descriptor) => {
      if (typeof property === "string" && "value" in descriptor)
        native.setItem(prefix + property, String(descriptor.value));
      return true;
    },
  });
}

export function installStorage(win: Realm, ctx: UrlContext): void {
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
          storage = createPartitionedStorage(getNative.call(win) as Storage, origin);
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
