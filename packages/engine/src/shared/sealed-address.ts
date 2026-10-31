/**
 * Sealed page addresses: `/~/x/<label>.<body>`. The label seals the origin under a key only the service worker holds,
 * and the body seals path and query under a per-origin key, so a page given its own origin's key cannot address another.
 */

import { PROXY_PREFIX } from "./codec.ts";
import type { OriginSeal } from "./protocol.ts";
import {
  bytesLength,
  exec,
  hashOf,
  indexOf,
  isWebUrl,
  originOf,
  parseUrl,
  pathnameOf,
  searchOf,
  setUrlPart,
  sliceOf,
  startsWith,
  urlPart,
  utf8Text,
} from "./primordials.ts";
import { fromBase64Url, hmacSha256, sivOpen, sivSeal, toBase64Url, utf8Bytes } from "./seal-cipher.ts";

export const SEALED_PREFIX = `${PROXY_PREFIX}x/`;

/** Reads a sealed path and query back as the page's real URL, or null when this key did not seal it. */
export type OpenSealed = (pathAndQuery: string) => URL | null;

const TOKEN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const ORIGIN_AD = utf8Bytes("girici/origin");
const KEY_BYTES = 32;
const MEMO_LIMIT = 512;

export function isSealedPath(pathname: string): boolean {
  return startsWith(pathname, SEALED_PREFIX);
}

interface OriginKey {
  seal: OriginSeal;
  key: Uint8Array;
}

/** The service worker's sealer, holding the browser's address key. */
export class MasterSealer {
  readonly #master: Uint8Array;
  readonly #originKey: Uint8Array;
  readonly #byOrigin = new Map<string, OriginKey>();
  readonly #byLabel = new Map<string, OriginKey | null>();

  constructor(key: Uint8Array) {
    this.#master = key;
    this.#originKey = hmacSha256(key, utf8Bytes("girici/v1 origin"));
  }

  /** Throws a TypeError for a URL the proxy cannot carry, as encodeUrl does. */
  seal(url: URL): string {
    if (!isWebUrl(url)) throw new TypeError(`Only http and https URLs can be sealed, got ${urlPart(url, "protocol")}`);
    const entry = this.#entry(originOf(url));
    return sealWith(entry.seal.label, entry.key, url);
  }

  readonly open: OpenSealed = (pathAndQuery) => openWith(pathAndQuery, (label) => this.#byLabelText(label));

  originSeal(origin: string): OriginSeal {
    return this.#entry(origin).seal;
  }

  #entry(origin: string): OriginKey {
    const known = this.#byOrigin.get(origin);
    if (known) return known;
    const label = toBase64Url(sivSeal(this.#originKey, ORIGIN_AD, utf8Bytes(origin)));
    const key = hmacSha256(this.#master, utf8Bytes(`girici/v1 path\0${origin}`));
    const entry = { seal: { origin, label, key: toBase64Url(key) }, key };
    remember(this.#byOrigin, origin, entry);
    remember(this.#byLabel, label, entry);
    return entry;
  }

  #byLabelText(label: string): OriginKey | null {
    if (this.#byLabel.has(label)) return this.#byLabel.get(label) ?? null;
    const sealed = fromBase64Url(label);
    const opened = sealed && sivOpen(this.#originKey, ORIGIN_AD, sealed);
    const origin = opened && utf8Text(opened, bytesLength(opened));
    const url = origin ? parseUrl(origin) : null;
    if (!origin || !url || !isWebUrl(url) || originOf(url) !== origin) {
      remember(this.#byLabel, label, null);
      return null;
    }
    return this.#entry(origin);
  }
}

function remember<T>(memo: Map<string, T>, key: string, value: T): void {
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, value);
}

/** What a sealed document's runtime gets: its own origin's key, which seals and opens that origin's pages only. */
export function createOriginSealer(
  seal: OriginSeal,
): { origin: string; seal(url: URL): string | null; open: OpenSealed } | null {
  const key = fromBase64Url(seal.key);
  if (!key || bytesLength(key) !== KEY_BYTES) return null;
  const { origin, label } = seal;
  const entry: OriginKey = { seal: { origin, label, key: seal.key }, key };
  return {
    origin,
    seal: (url) => (isWebUrl(url) && originOf(url) === origin ? sealWith(label, key, url) : null),
    open: (pathAndQuery) => openWith(pathAndQuery, (other) => (other === label ? entry : null)),
  };
}

function sealWith(label: string, key: Uint8Array, url: URL): string {
  const body = toBase64Url(sivSeal(key, utf8Bytes(label), utf8Bytes(pathnameOf(url) + searchOf(url))));
  return `${SEALED_PREFIX}${label}.${body}${hashOf(url)}`;
}

function openWith(pathAndQuery: string, keyFor: (label: string) => OriginKey | null): URL | null {
  if (!isSealedPath(pathAndQuery)) return null;
  const question = indexOf(pathAndQuery, "?");
  const token = sliceOf(pathAndQuery, SEALED_PREFIX.length, question < 0 ? undefined : question);
  const parts = exec(TOKEN, token);
  if (!parts) return null;
  const label = parts[1] as string;
  const entry = keyFor(label);
  const sealed = entry && fromBase64Url(parts[2] as string);
  const opened = entry && sealed && sivOpen(entry.key, utf8Bytes(label), sealed);
  if (!entry || !opened) return null;
  const path = utf8Text(opened, bytesLength(opened));
  if (!startsWith(path, "/")) return null;
  const url = parseUrl(entry.seal.origin + path);
  if (!url || urlPart(url, "username") || urlPart(url, "password") || !urlPart(url, "hostname")) return null;
  if (originOf(url) !== entry.seal.origin) return null;
  if (question >= 0) setUrlPart(url, "search", sliceOf(pathAndQuery, question + 1));
  return url;
}
