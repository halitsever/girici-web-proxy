import {
  append,
  apply,
  assignOwn,
  createObject,
  defineData,
  indexOf,
  joined,
  pathnameOf,
  promiseThen,
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
  const page = pageRealm(win);

  prefixFirstArg(win.IDBFactory?.prototype, ["open", "deleteDatabase"], partition);
  wrap(
    win.IDBFactory?.prototype,
    "databases",
    (native) =>
      function (this: unknown) {
        return promiseThen(
          page.later(() => apply(native, this, [])),
          (all) => stripNamed(all as Named[], strip, page),
        );
      },
  );

  prefixFirstArg(win.CacheStorage?.prototype, ["open", "has", "delete"], partition);
  wrap(
    win.CacheStorage?.prototype,
    "keys",
    (native) =>
      function (this: unknown) {
        return promiseThen(
          page.later(() => apply(native, this, [])),
          (found) => {
            const all = found as string[];
            const own = page.list<string>();
            for (let index = 0; index < all.length; index++) {
              const name = strip(all[index] as string);
              if (name !== null) append(own, name);
            }
            return own;
          },
        );
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
          // Own fields on a null prototype: the native reads every option it knows of.
          const named = assignOwn(createObject<Record<string, unknown>>(null), options);
          defineData(named, "cacheName", partition() + options.cacheName);
          return apply(native, this, [request, named]);
        }
        return promiseThen(
          page.later(() => caches.keys()),
          (names) => {
            const next = (index: number): unknown => {
              if (index >= names.length) return undefined;
              const opened = page.later(() => caches.open(names[index] as string));
              const found = promiseThen(opened, (cache) =>
                page.later(() => cache.match(request as RequestInfo, options)),
              );
              return promiseThen(found, (hit) => (hit ? hit : next(index + 1)));
            };
            return next(0);
          },
        );
      },
  );

  const LockManager = (win as unknown as { LockManager?: { prototype: object } }).LockManager;
  prefixFirstArg(LockManager?.prototype, ["request"], partition);
  wrap(
    LockManager?.prototype,
    "query",
    (native) =>
      function (this: unknown) {
        return promiseThen(
          page.later(() => apply(native, this, [])),
          (found) => {
            const result = found as { held?: Named[]; pending?: Named[] };
            const out = assignOwn(page.object(), result);
            defineData(out, "held", stripNamed(result.held, strip, page));
            defineData(out, "pending", stripNamed(result.pending, strip, page));
            return out;
          },
        );
      },
  );

  if (win.BroadcastChannel) {
    win.BroadcastChannel = hookConstructor(win.BroadcastChannel, (input) =>
      joined([partition() + toText(input[0])], input, 1),
    );
  }

  installCookieStore(win, ctx);
}

interface Named {
  name?: string;
}

/** Makes answers out of the window's own Promise, Object and Array, taken at install. */
interface PageRealm {
  /** run() as a promise of the window's realm, rejected if run throws. */
  later<T>(run: () => T | PromiseLike<T>): Promise<T>;
  object<T extends object>(): T;
  list<T>(): T[];
}

/**
 * In a window reused for another site, this realm's built-ins belong to the page that made the window, so promises,
 * arrays and objects handed to the page come from the window's own realm.
 */
function pageRealm(win: Realm): PageRealm {
  const PagePromise = win.Promise;
  const objectProto = win.Object.prototype;
  const PageArray = win.Array;
  return {
    __proto__: null,
    later: <T>(run: () => T | PromiseLike<T>) => new PagePromise<T>((resolve) => resolve(run())),
    object: <T extends object>() => createObject<T>(objectProto),
    list: <T>() => new PageArray<T>(),
  } as PageRealm;
}

/** Database and lock entries with this partition's prefix taken off, and other partitions' left out. */
function stripNamed(entries: Named[] | undefined, strip: (name: string) => string | null, page: PageRealm): Named[] {
  const out = page.list<Named>();
  if (!entries) return out;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index] as Named;
    const name = entry.name === undefined ? undefined : strip(entry.name);
    if (entry.name !== undefined && name === null) continue;
    const copy = assignOwn(page.object<Named>(), entry);
    defineData(copy, "name", name ?? undefined);
    append(out, copy);
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

/** cookieStore is a typed view of document.cookie, so it reuses the mirror the cookie hooks maintain. */
function installCookieStore(win: Realm, ctx: UrlContext): void {
  const instance = (win as unknown as { cookieStore?: Record<string, unknown> }).cookieStore;
  if (!instance) return;
  // WebKit gives the next document of a reused window a new cookieStore, which still inherits from this prototype.
  const CookieStore = (win as unknown as { CookieStore?: { prototype: Record<string, unknown> } }).CookieStore;
  const store = CookieStore?.prototype ?? instance;
  const page = pageRealm(win);
  const answer = page.later;
  const item = (name: string, value: string): CookieItem => {
    const made = page.object<CookieItem>();
    defineData(made, "name", name);
    defineData(made, "value", value);
    return made;
  };
  const parse = (text: string): CookieItem[] => {
    const pairs = splitText(text, "; ");
    const items = page.list<CookieItem>();
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
