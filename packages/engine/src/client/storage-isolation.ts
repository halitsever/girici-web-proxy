import { apply, sliceOf, startsWith, toText } from "../shared/primordials.ts";
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
          for (const name of await caches.keys()) {
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
    win.BroadcastChannel = hookConstructor(win.BroadcastChannel, (input) => [
      partition() + toText(input[0]),
      ...input.slice(1),
    ]);
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

function prefixFirstArg(proto: object | undefined, methods: string[], prefix: () => string): void {
  for (const method of methods) {
    wrap(
      proto,
      method,
      (native) =>
        function (this: unknown, name: unknown, ...rest: unknown[]) {
          return apply(native, this, [prefix() + toText(name), ...rest]);
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

/** cookieStore is a typed view of document.cookie, so it reuses the mirror the cookie hooks maintain. */
function installCookieStore(win: Realm, ctx: UrlContext): void {
  const store = (win as unknown as { cookieStore?: Record<string, unknown> }).cookieStore;
  if (!store) return;
  const parse = (text: string) =>
    text
      .split("; ")
      .filter(Boolean)
      .map((pair) => {
        const index = pair.indexOf("=");
        return { name: pair.slice(0, index), value: pair.slice(index + 1) };
      });
  // get/delete accept both a bare name and the { name } object form the native API allows.
  const nameOf = (input: unknown) =>
    typeof input === "object" && input ? String((input as { name?: unknown }).name) : String(input);
  store.get = async (name: unknown) => parse(win.document.cookie).find((c) => c.name === nameOf(name)) ?? null;
  store.getAll = async () => parse(win.document.cookie);
  store.set = async (name: unknown, value?: unknown) => {
    const cookie =
      typeof name === "object" && name
        ? (name as { name: string; value: string })
        : { name: String(name), value: String(value) };
    win.document.cookie = `${cookie.name}=${cookie.value}; path=${new URL(ctx.realUrl().href).pathname}`;
  };
  store.delete = async (name: unknown) => {
    win.document.cookie = `${nameOf(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  };
}
