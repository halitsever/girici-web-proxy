import { getDomain } from "tldts";
import { Cookie, CookieJar, MemoryCookieStore } from "tough-cookie";
import type { CookieSnapshot } from "../../shared/protocol.ts";
import { allowsCredentials, sameSiteContext, type SameSiteContext } from "./policy.ts";

export interface CookieRequestContext {
  initiator: URL | null;
  credentials: RequestCredentials;
  topLevel: boolean;
  method: string;
}

export interface CookieRecordStore {
  loadAll(): Promise<Array<{ key: string; value: unknown }>>;
  write(puts: Array<{ key: string; value: unknown }>, deletes: string[]): Promise<void>;
}

export const COOKIE_LIMITS = { perCookie: 4096, perSite: 180, total: 5000 } as const;

interface SetOptions {
  sameSiteContext: SameSiteContext;
  http: boolean;
}

/** All proxied sites share one browser origin, so their cookies live here, scoped by real URLs. */
export class CookieService {
  readonly #records: CookieRecordStore;
  readonly #flushDelay: number;
  readonly #memory = new MemoryCookieStore();
  readonly #jar = new CookieJar(this.#memory, { prefixSecurity: "strict" });
  readonly #listeners = new Set<(changes: CookieSnapshot[]) => void>();
  readonly #dirty = new Map<string, Cookie | null>();
  #loaded: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #writing: Promise<void> = Promise.resolve();

  constructor(records: CookieRecordStore, options: { flushDelay?: number } = {}) {
    this.#records = records;
    this.#flushDelay = options.flushDelay ?? 50;
  }

  ready(): Promise<void> {
    this.#loaded ??= this.#load();
    return this.#loaded;
  }

  async header(target: URL, ctx: CookieRequestContext): Promise<string | null> {
    if (!allowsCredentials(ctx.credentials, ctx.initiator, target)) return null;
    const value = await this.#jar.getCookieString(target.href, {
      sameSiteContext: sameSiteContext(ctx.initiator, target, ctx),
      http: true,
    });
    return value || null;
  }

  /** Returns the stored cookies that page scripts are allowed to see. */
  async store(target: URL, setCookies: string[], ctx: CookieRequestContext): Promise<CookieSnapshot[]> {
    if (setCookies.length === 0 || !allowsCredentials(ctx.credentials, ctx.initiator, target)) return [];
    const options = { sameSiteContext: sameSiteContext(ctx.initiator, target, ctx), http: true };
    const changes: CookieSnapshot[] = [];
    for (const header of setCookies) {
      const cookie = await this.#set(header, target, options);
      if (cookie && !cookie.httpOnly) changes.push(snapshotOf(cookie));
    }
    await this.#enforceLimits(target);
    this.#emit(changes);
    return changes;
  }

  async setFromScript(documentUrl: URL, cookie: string): Promise<void> {
    // http: false makes tough-cookie refuse HttpOnly cookies, as document.cookie must.
    const stored = await this.#set(cookie, documentUrl, { sameSiteContext: "strict", http: false });
    await this.#enforceLimits(documentUrl);
    if (stored) this.#emit([snapshotOf(stored)]);
  }

  /** Every script-visible cookie for the document's host, whatever its path, so the page can filter after pushState. */
  async snapshot(documentUrl: URL): Promise<CookieSnapshot[]> {
    const cookies = await this.#jar.getCookies(documentUrl.href, { http: false, allPaths: true });
    return cookies.map(snapshotOf).sort((a, b) => a.creation - b.creation);
  }

  onChange(listener: (changes: CookieSnapshot[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const pending = [...this.#dirty];
    this.#dirty.clear();
    const puts: Array<{ key: string; value: unknown }> = [];
    const deletes: string[] = [];
    for (const [key, cookie] of pending) {
      if (cookie && !isExpired(cookie)) puts.push({ key, value: cookie.toJSON() });
      else deletes.push(key);
    }
    this.#writing = this.#writing.then(() => (pending.length > 0 ? this.#records.write(puts, deletes) : undefined));
    await this.#writing;
  }

  async #load(): Promise<void> {
    const expired: string[] = [];
    for (const { key, value } of await this.#records.loadAll()) {
      const cookie = Cookie.fromJSON(value);
      if (cookie && !isExpired(cookie)) await this.#memory.putCookie(cookie);
      else expired.push(key);
    }
    if (expired.length > 0) await this.#records.write([], expired);
  }

  async #set(header: string, url: URL, options: SetOptions): Promise<Cookie | undefined> {
    const parsed = Cookie.parse(header);
    if (!parsed || parsed.key.length + parsed.value.length > COOKIE_LIMITS.perCookie) return undefined;
    const cookie = await this.#jar.setCookie(header, url.href, { ...options, ignoreError: true });
    if (cookie) this.#markDirty(keyOf(cookie), cookie);
    return cookie;
  }

  /** Over the limits, the least recently used cookies go first, as in browsers. */
  async #enforceLimits(url: URL): Promise<void> {
    const all = await this.#memory.getAllCookies();
    const site = siteOf(url.hostname);
    const evicted = leastRecentlyUsed(
      all.filter((cookie) => siteOf(cookie.domain ?? "") === site),
      COOKIE_LIMITS.perSite,
    );
    const remaining = all.filter((cookie) => !evicted.includes(cookie));
    evicted.push(...leastRecentlyUsed(remaining, COOKIE_LIMITS.total));
    for (const cookie of evicted) {
      await this.#memory.removeCookie(cookie.domain ?? "", cookie.path ?? "", cookie.key);
      this.#markDirty(keyOf(cookie), null);
    }
  }

  #markDirty(key: string, cookie: Cookie | null): void {
    this.#dirty.set(key, cookie);
    this.#timer ??= setTimeout(() => void this.flush(), this.#flushDelay);
  }

  #emit(changes: CookieSnapshot[]): void {
    if (changes.length === 0) return;
    for (const listener of this.#listeners) listener(changes);
  }
}

function leastRecentlyUsed(cookies: Cookie[], limit: number): Cookie[] {
  if (cookies.length <= limit) return [];
  return [...cookies].sort((a, b) => usedAt(a) - usedAt(b)).slice(0, cookies.length - limit);
}

function usedAt(cookie: Cookie): number {
  const date = cookie.lastAccessed instanceof Date ? cookie.lastAccessed : cookie.creation;
  return date instanceof Date ? date.getTime() : 0;
}

function keyOf(cookie: Cookie): string {
  return `${cookie.domain ?? ""}|${cookie.path ?? ""}|${cookie.key}`;
}

function siteOf(hostname: string): string {
  return getDomain(hostname) ?? hostname;
}

function isExpired(cookie: Cookie): boolean {
  const expiry = cookie.expiryTime();
  return expiry !== undefined && expiry <= Date.now();
}

function snapshotOf(cookie: Cookie): CookieSnapshot {
  const expiry = cookie.expiryTime();
  return {
    name: cookie.key,
    value: cookie.value,
    domain: cookie.domain ?? "",
    path: cookie.path ?? "/",
    hostOnly: cookie.hostOnly ?? true,
    secure: cookie.secure,
    expires: expiry !== undefined && Number.isFinite(expiry) ? expiry : null,
    creation: cookie.creation instanceof Date ? cookie.creation.getTime() : Date.now(),
  };
}
