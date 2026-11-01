import {
  append,
  apply,
  createObject,
  define,
  indexOf,
  joined,
  pathnameOf,
  sliceOf,
  splitText,
  startsWith,
  toText,
} from "../shared/primordials.ts";
import { hookConstructor } from "./constructors.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Named storage and messaging share our origin, so each partition's databases, caches, channels and locks are prefixed. */
export function installStorageIsolation(win: Realm, ctx: UrlContext, partition: () => string): void {
  const strip = (name: string): string | null => {
    const prefix = partition();
    // Names of other partitions pass through here, and a third-party name tells which site embedded which.
    return startsWith(name, prefix) ? sliceOf(name, prefix.length) : null;
  };

  prefixFirstArg(win.IDBFactory?.prototype, ["open", "deleteDatabase"], partition);
  wrap(
    win.IDBFactory?.prototype,
    "databases",
    (native) =>
      async function (this: unknown) {
        const all = (await apply(native, this, [])) as NamedLock[];
        return stripLocks(all, strip);
      },
  );

  prefixFirstArg(win.CacheStorage?.prototype, ["open", "has", "delete"], partition);
  wrap(
    win.CacheStorage?.prototype,
    "keys",
    (native) =>
      async function (this: unknown) {
        const all = (await apply(native, this, [])) as string[];
        const own: string[] = [];
        for (let index = 0; index < all.length; index++) {
          const name = strip(all[index] as string);
          if (name !== null) own[own.length] = name;
        }
        return own;
      },
  );
  // match() with no cacheName searches every cache on the origin, so it is confined to this site's own caches.
  wrap(
    win.CacheStorage?.prototype,
    "match",
    (native) =>
      function (this: unknown, request: unknown, rawOptions?: unknown) {
        const caches = this as CacheStorage;
        const options = rawOptions as CacheQueryOptions & { cacheName?: string };
        if (options?.cacheName) {
          return apply(native, this, [request, { ...options, cacheName: partition() + options.cacheName }]);
        }
        return (async () => {
          const names = await caches.keys();
          for (let index = 0; index < names.length; index++) {
            const name = names[index] as string;
            const hit = await (await caches.open(name)).match(request as RequestInfo, options);
            if (hit) return hit;
          }
          return undefined;
        })();
      },
  );

  const LockManager = (win as unknown as { LockManager?: { prototype: object } }).LockManager;
  prefixFirstArg(LockManager?.prototype, ["request"], partition);
  wrap(
    LockManager?.prototype,
    "query",
    (native) =>
      async function (this: unknown) {
        const result = (await apply(native, this, [])) as { held?: NamedLock[]; pending?: NamedLock[] };
        return { ...result, held: stripLocks(result.held, strip), pending: stripLocks(result.pending, strip) };
      },
  );

  if (win.BroadcastChannel) {
    win.BroadcastChannel = hookConstructor(win.BroadcastChannel, (input) =>
      joined([partition() + toText(input[0])], input, 1),
    );
  }

  installCookieStore(win, ctx);
}

interface NamedLock {
  name?: string;
}

function stripLocks(locks: NamedLock[] | undefined, strip: (name: string) => string | null): NamedLock[] {
  if (!locks) return [];
  const out: NamedLock[] = [];
  for (let index = 0; index < locks.length; index++) {
    const lock = locks[index] as NamedLock;
    const name = lock.name === undefined ? undefined : strip(lock.name);
    if (lock.name !== undefined && name === null) continue;
    out[out.length] = { ...lock, name: name ?? undefined };
  }
  return out;
}

type Method = (this: unknown, ...args: unknown[]) => unknown;

/** Indexed, without spreads: adopting a frame runs this inside a page call, after the page may have replaced them. */
function prefixFirstArg(proto: object | undefined, methods: string[], prefix: () => string): void {
  for (let index = 0; index < methods.length; index++) {
    wrap(
      proto,
      methods[index] as string,
      (native) =>
        function (this: unknown, name: unknown, ...rest: unknown[]) {
          return apply(native, this, joined([prefix() + toText(name)], rest));
        },
    );
  }
}

/** Replaces a prototype method with a wrapper the caller builds from the original; `this` is left to the call site. */
function wrap(proto: object | undefined, name: string, make: (native: Method) => Method): void {
  if (!proto) return;
  const target = proto as Record<string, unknown>;
  const native = target[name];
  if (typeof native !== "function") return;
  target[name] = make(native as Method);
}

interface CookieItem {
  name: string;
  value: string;
}

/**
 * cookieStore is a typed view of document.cookie, so it reuses the mirror the cookie hooks maintain. Answers use the
 * window's own Promise, Object and Array, taken at install: in a window reused for another site, this realm's
 * built-ins belong to the page that made the window.
 */
function installCookieStore(win: Realm, ctx: UrlContext): void {
  const instance = (win as unknown as { cookieStore?: Record<string, unknown> }).cookieStore;
  if (!instance) return;
  // WebKit gives the next document of a reused window a new cookieStore, which still inherits from this prototype.
  const CookieStore = (win as unknown as { CookieStore?: { prototype: Record<string, unknown> } }).CookieStore;
  const store = CookieStore?.prototype ?? instance;
  const PagePromise = win.Promise;
  const pageObject = win.Object.prototype;
  const PageArray = win.Array;
  const answer = <T>(run: () => T): Promise<T> => new PagePromise<T>((resolve) => resolve(run()));
  const item = (name: string, value: string): CookieItem => {
    const made = createObject<CookieItem>(pageObject);
    define(made, "name", { value: name, writable: true, enumerable: true, configurable: true });
    define(made, "value", { value, writable: true, enumerable: true, configurable: true });
    return made;
  };
  const parse = (text: string): CookieItem[] => {
    const pairs = splitText(text, "; ");
    const items = new PageArray<CookieItem>();
    for (let index = 0; index < pairs.length; index++) {
      const pair = pairs[index] as string;
      if (!pair) continue;
      const at = indexOf(pair, "=");
      append(items, item(sliceOf(pair, 0, at), sliceOf(pair, at + 1)));
    }
    return items;
  };
  // get/delete accept both a bare name and the { name } object form the native API allows.
  const nameOf = (input: unknown) =>
    typeof input === "object" && input ? toText((input as { name?: unknown }).name) : toText(input);
  store.get = (name: unknown) =>
    answer(() => {
      const items = parse(win.document.cookie);
      for (let index = 0; index < items.length; index++) {
        const found = items[index] as CookieItem;
        if (found.name === nameOf(name)) return found;
      }
      return null;
    });
  store.getAll = () => answer(() => parse(win.document.cookie));
  store.set = (name: unknown, value?: unknown) =>
    answer(() => {
      const cookie =
        typeof name === "object" && name
          ? (name as { name: string; value: string })
          : ({ __proto__: null, name: toText(name), value: toText(value) } as CookieItem);
      win.document.cookie = `${cookie.name}=${cookie.value}; path=${pathnameOf(ctx.realUrl())}`;
    });
  store.delete = (name: unknown) =>
    answer(() => {
      win.document.cookie = `${nameOf(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    });
}
