import {
  apply,
  hrefOf,
  joined,
  NativeMap,
  NativeWeakMap,
  ownValue,
  parseUrl,
  protocolOf,
  setUrlPart,
  toText,
} from "../shared/primordials.ts";
import { maskNative } from "./native-mask.ts";

/** Page channel names always carry a partition prefix, so no page can open this one. */
export const OWNERS_CHANNEL = "__girici_blob_owners";
/** A blob URL lives only as long as the realm that made it, so a creator that stays silent this long is gone. */
export const ASK_TIMEOUT = 300;

// Taken at load: checks run inside page calls, after page code may have replaced these.
const describe = Object.getOwnPropertyDescriptor;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const weakDelete = WeakMap.prototype.delete;
const random = Math.random;

/**
 * Every blob: URL a proxied site makes is on our one origin, so each realm remembers which partition made its URLs and
 * answers other realms that ask, over a channel all of them share.
 */
export interface BlobOwners {
  /** Calls back with false only when another partition made `url`; anything else is not a blob of ours to guard. */
  check(url: string, done: (allowed: boolean) => void): void;
  /** The answer without asking other realms: null when only they know. */
  known(url: string): boolean | null;
}

export interface OwnerRealm {
  URL?: { createObjectURL?: (object: unknown) => string; revokeObjectURL?: (url: string) => void };
  BroadcastChannel?: new (name: string) => object;
  MessageEvent?: { prototype: object };
  setTimeout: (handler: () => void, timeout: number) => unknown;
}

interface Channel {
  onmessage: ((event: unknown) => void) | null;
}

/** Takes the realm's BroadcastChannel, so this runs before storage isolation prefixes its names. */
export function installBlobOwners(realm: OwnerRealm, partition: () => string): BlobOwners {
  const urls = realm.URL;
  const create = urls?.createObjectURL;
  const revoke = urls?.revokeObjectURL;
  const Broadcast = realm.BroadcastChannel;
  const post = (Broadcast?.prototype as { postMessage?: (message: unknown) => void } | undefined)?.postMessage;
  const dataOf = realm.MessageEvent ? describe(realm.MessageEvent.prototype, "data")?.get : undefined;
  const timer = realm.setTimeout;
  const made = new NativeMap<string, string>();
  const waiting = new NativeMap<string, (owner: string) => void>();
  let channel: Channel | null = null;
  let asked = 0;

  const send = (kind: string, id: string, value: string) => {
    if (channel && post) apply(post, channel, [{ __proto__: null, kind, id, value }]);
  };
  const receive = (event: unknown) => {
    const data: unknown = dataOf ? apply(dataOf, event, []) : null;
    if (typeof data !== "object" || data === null) return;
    // Own fields only: a page's Object.prototype must not turn an answer into a question.
    const kind = ownValue(data, "kind");
    const id = ownValue(data, "id");
    const value = ownValue(data, "value");
    if (typeof id !== "string" || typeof value !== "string") return;
    if (kind === "ask") {
      const owner = apply(mapGet, made, [value]) as string | undefined;
      if (owner !== undefined) send("owner", id, owner);
    } else if (kind === "owner") {
      const resolve = apply(mapGet, waiting, [id]) as ((owner: string) => void) | undefined;
      if (resolve && apply(mapDelete, waiting, [id])) resolve(value);
    }
  };
  let opened = false;
  /** Opened on first use: most pages make no blob URL, and an open channel can keep a page out of the back/forward cache. */
  const listen = (): Channel | null => {
    if (opened) return channel;
    opened = true;
    if (!Broadcast || !post || !dataOf) return null;
    try {
      channel = new Broadcast(OWNERS_CHANNEL) as Channel;
      channel.onmessage = receive;
    } catch {
      channel = null;
    }
    return channel;
  };

  const known = (url: string): boolean | null => {
    const key = blobKey(url);
    if (key === null) return true;
    const owner = apply(mapGet, made, [key]) as string | undefined;
    return owner === undefined ? null : owner === partition();
  };
  const check = (url: string, done: (allowed: boolean) => void): void => {
    const now = known(url);
    const key = blobKey(url);
    if (now !== null || key === null || !listen()) {
      done(now !== false);
      return;
    }
    const id = `${toText(random())}:${toText(++asked)}`;
    apply(mapSet, waiting, [id, (owner: string) => done(owner === partition())]);
    apply(timer, realm, [
      () => {
        if (apply(mapDelete, waiting, [id])) done(true);
      },
      ASK_TIMEOUT,
    ]);
    send("ask", id, key);
  };

  if (urls && create) {
    urls.createObjectURL = maskNative(function (this: unknown, object: unknown) {
      const url = apply(create, this, [object]) as string;
      const key = blobKey(url);
      if (key !== null) {
        apply(mapSet, made, [key, partition()]);
        listen();
      }
      return url;
    }, create);
  }
  if (urls && revoke) {
    // Another partition's URL would otherwise be gone for the site that made it.
    urls.revokeObjectURL = maskNative(function (this: unknown, url: unknown) {
      const address = toText(url);
      const key = blobKey(address);
      if (key !== null && apply(mapDelete, made, [key])) {
        apply(revoke, this, [address]);
        return;
      }
      check(address, (allowed) => {
        if (allowed) apply(revoke, urls, [address]);
      });
    }, revoke);
  }
  return { __proto__: null, check, known } as BlobOwners;
}

export interface GateRealm {
  fetch?: (input: unknown, init?: unknown) => unknown;
  Request?: { prototype: object };
  XMLHttpRequest?: { prototype: object };
  Promise: PromiseConstructor;
  TypeError: TypeErrorConstructor;
}

type Xhr = Record<string, unknown>;
type XhrCall = (this: unknown, ...args: unknown[]) => unknown;

interface Opened {
  method: unknown;
  url: string;
  rest: unknown[];
  sync: boolean;
}

/**
 * Holds back fetch and XMLHttpRequest reads of a blob: URL until the realms that could have made it have answered, and
 * fails the ones another partition made as the browser fails a revoked one. Installed over the network hooks.
 */
export function installBlobGates(realm: GateRealm, owners: BlobOwners, origin: string): void {
  const PagePromise = realm.Promise;
  const PageTypeError = realm.TypeError;
  const Request = realm.Request as (new (input: string) => object) | undefined;
  const requestUrl = Request ? (describe(Request.prototype, "url")?.get as (this: unknown) => string) : undefined;
  // No blob has this address, so the browser fails it the way it fails another partition's.
  const missing = `blob:${origin}/00000000-0000-0000-0000-000000000000`;

  const fetch = realm.fetch;
  if (fetch) {
    realm.fetch = maskNative(function (this: unknown, input: unknown, init?: unknown) {
      // Read once, so a page object cannot name one address to the check and another to the request.
      const request = Request && requestUrl && input instanceof Request;
      const address = request ? apply(requestUrl, input, []) : toText(input);
      const target = request ? input : address;
      const allowed = owners.known(address);
      if (allowed === true) return apply(fetch, this, [target, init]);
      return new PagePromise((resolve, reject) =>
        owners.check(address, (ok) => {
          if (ok) resolve(apply(fetch, this, [target, init]));
          else reject(new PageTypeError("Failed to fetch"));
        }),
      );
    }, fetch);
  }

  const proto = realm.XMLHttpRequest?.prototype as Xhr | undefined;
  const open = proto?.open as XhrCall | undefined;
  const send = proto?.send as XhrCall | undefined;
  const abort = proto?.abort as XhrCall | undefined;
  if (!proto || !open || !send) return;
  const opened = new NativeWeakMap<object, Opened>();
  proto.open = maskNative(function (this: object, method: unknown, url: unknown, ...rest: unknown[]) {
    const address = toText(url);
    if (blobKey(address) === null) apply(weakDelete, opened, [this]);
    // A third argument turns the request synchronous only when it is false.
    else apply(weakSet, opened, [this, { method, url: address, rest, sync: rest.length > 0 && !rest[0] }]);
    return apply(open, this, joined([method, address], rest));
  }, open);
  const refuse = (xhr: object, entry: Opened) => {
    apply(open, xhr, joined([entry.method, missing], entry.rest));
    return apply(send, xhr, [null]);
  };
  proto.send = maskNative(function (this: object, body?: unknown) {
    const entry = apply(weakGet, opened, [this]) as Opened | undefined;
    if (!entry) return apply(send, this, [body]);
    const allowed = owners.known(entry.url);
    // A synchronous request cannot wait for other realms, so only this realm's own answer counts.
    if (allowed === true || (allowed === null && entry.sync)) return apply(send, this, [body]);
    if (allowed === false) return refuse(this, entry);
    owners.check(entry.url, (ok) => {
      // Opened again or aborted while it waited.
      if (apply(weakGet, opened, [this]) !== entry) return;
      try {
        if (ok) apply(send, this, [body]);
        else refuse(this, entry);
      } catch {
        // The page closed the request in the meantime.
      }
    });
    return undefined;
  }, send);
  if (abort) {
    proto.abort = maskNative(function (this: object) {
      apply(weakDelete, opened, [this]);
      return apply(abort, this, []);
    }, abort);
  }
}

/** The address a blob: URL is known by, without its fragment, which never reaches the blob store; null for others. */
export function blobKey(value: string): string | null {
  const url = parseUrl(value);
  if (!url || protocolOf(url) !== "blob:") return null;
  setUrlPart(url, "hash", "");
  return hrefOf(url);
}
