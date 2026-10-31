/**
 * Built-ins taken when the engine bundle loads, before any page script. Pages share our realm and can replace the
 * originals, which would let a navigation's URL skip the proxy or hand a native to page code.
 */

export const apply = Reflect.apply;
const defineProperty = Reflect.defineProperty;
const ownDescriptor = Reflect.getOwnPropertyDescriptor;
const NativeUrl = URL;
const NativeString = String;
const strings = String.prototype;
const nativeStartsWith = strings.startsWith;
const nativeEndsWith = strings.endsWith;
const nativeSlice = strings.slice;
const nativeIndexOf = strings.indexOf;
const nativeIncludes = strings.includes;
const nativeToLowerCase = strings.toLowerCase;
const nativeTrim = strings.trim;
const nativeCodePointAt = strings.codePointAt;
const nativeArrayIncludes = Array.prototype.includes;
const nativeIsArray = Array.isArray;
const nativeParseInt = parseInt;
const NativeJson = JSON;
const jsonStringify = JSON.stringify;
const jsonParse = JSON.parse;
const NativeArrayBuffer = ArrayBuffer;
const NativeUint8Array = Uint8Array;
const typedArrays = Reflect.getPrototypeOf(Uint8Array.prototype) as object;
const bufferOf = ownDescriptor(typedArrays, "buffer")?.get as () => ArrayBuffer;
const typedLength = ownDescriptor(typedArrays, "length")?.get as () => number;
const nativeDecode = TextDecoder.prototype.decode;
const utf8Decoder = new TextDecoder();
const nativeExec = RegExp.prototype.exec;
const nativeSetHas = Set.prototype.has;
const objectToString = Object.prototype.toString;
const objectDefine = Object.defineProperty;
const hasOwn = Object.prototype.hasOwnProperty;
const DESCRIPTOR_FIELDS = ["value", "writable", "get", "set", "enumerable", "configurable"];

/** For tables made inside page calls, where a page's own collection classes would break the captured methods. */
export const NativeWeakMap = WeakMap;
export const NativeWeakSet = WeakSet;
export const NativeMap = Map;

/** String(value), which runs the value's own conversion once and gives a primitive the checks can trust. */
export const toText = NativeString as (value: unknown) => string;

export function startsWith(text: string, prefix: string): boolean {
  return apply(nativeStartsWith, text, [prefix]);
}

export function endsWith(text: string, suffix: string): boolean {
  return apply(nativeEndsWith, text, [suffix]);
}

export function sliceOf(text: string, start: number, end?: number): string {
  return apply(nativeSlice, text, [start, end]);
}

export function indexOf(text: string, search: string, from?: number): number {
  return apply(nativeIndexOf, text, [search, from]);
}

export function includes(text: string, search: string): boolean {
  return apply(nativeIncludes, text, [search]);
}

export function lowerCase(text: string): string {
  return apply(nativeToLowerCase, text, []);
}

export function trim(text: string): string {
  return apply(nativeTrim, text, []);
}

export function codePointAt(text: string, index: number): number | undefined {
  return apply(nativeCodePointAt, text, [index]);
}

export function parseHex(text: string): number {
  return nativeParseInt(text, 16);
}

export function exec(pattern: RegExp, text: string): RegExpExecArray | null {
  return apply(nativeExec, pattern, [text]);
}

/** Replaces every match of a global pattern; String.prototype.replace would look `exec` up on the prototype. */
export function replaceAll(text: string, pattern: RegExp, replacement: (match: string) => string): string {
  pattern.lastIndex = 0;
  let result = "";
  let last = 0;
  for (let match = exec(pattern, text); match; match = exec(pattern, text)) {
    const found = match[0];
    result += sliceOf(text, last, match.index) + replacement(found);
    last = match.index + found.length;
    if (!found) pattern.lastIndex++;
  }
  return result + sliceOf(text, last);
}

/** Array.prototype.map without the prototype: entries are defined, so an index setter on Array.prototype never runs. */
export function mapOf<T, U>(items: ArrayLike<T>, map: (item: T) => U): U[] {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++) {
    defineProperty(result, index, {
      __proto__: null,
      value: map(items[index] as T),
      writable: true,
      enumerable: true,
      configurable: true,
    } as PropertyDescriptor);
  }
  return result;
}

export const isArray = nativeIsArray as (value: unknown) => value is unknown[];

/** An own property's value, or undefined; never one a page put on a prototype. */
export function ownValue(object: object, key: PropertyKey): unknown {
  return apply(hasOwn, object, [key]) ? (object as Record<PropertyKey, unknown>)[key] : undefined;
}

export function listIncludes<T>(list: readonly T[], value: T): boolean {
  return apply(nativeArrayIncludes, list, [value]);
}

/** JSON.stringify of a string, which reads nothing from the page. */
export function quoteJson(text: string): string {
  return apply(jsonStringify, NativeJson, [text]);
}

export function parseJson(text: string): unknown {
  return apply(jsonParse, NativeJson, [text]);
}

/** A zeroed byte view whose indexed writes never reach a prototype. */
export function newBytes(size: number): Uint8Array {
  return new NativeUint8Array(new NativeArrayBuffer(size));
}

/** A typed array's length; `.length` is a prototype getter a page can replace. */
export function bytesLength(bytes: Uint8Array): number {
  return apply(typedLength, bytes, []);
}

/** The first `length` bytes as UTF-8, with U+FFFD for invalid sequences. */
export function utf8Text(bytes: Uint8Array, length: number): string {
  return apply(nativeDecode, utf8Decoder, [new NativeUint8Array(apply(bufferOf, bytes, []), 0, length)]);
}

/** Object.defineProperty that reads only the descriptor's own fields, so none comes from a page's Object.prototype. */
export function define<T>(target: T, key: PropertyKey, descriptor: PropertyDescriptor): T {
  const own = { __proto__: null } as Record<string, unknown>;
  for (let index = 0; index < DESCRIPTOR_FIELDS.length; index++) {
    const field = DESCRIPTOR_FIELDS[index] as keyof PropertyDescriptor;
    if (apply(hasOwn, descriptor, [field])) own[field] = descriptor[field];
  }
  return objectDefine(target, key, own as PropertyDescriptor);
}

/** `[...head, ...rest.slice(from)]` without the array iterator, which a page can replace. */
export function joined(head: readonly unknown[], rest: ArrayLike<unknown>, from = 0): unknown[] {
  const out: unknown[] = [];
  for (let index = 0; index < head.length; index++) append(out, head[index]);
  for (let index = from; index < rest.length; index++) append(out, rest[index]);
  return out;
}

/** Adds to the end of `list` without Array.prototype.push or an index setter a page put on Array.prototype. */
export function append<T>(list: T[], item: T): void {
  defineProperty(list, list.length, {
    __proto__: null,
    value: item,
    writable: true,
    enumerable: true,
    configurable: true,
  } as PropertyDescriptor);
}

export function setHas<T>(set: Set<T>, value: T): boolean {
  return apply(nativeSetHas, set, [value]);
}

/** The [object Tag] brand, read without Function.prototype.call. */
export function brandOf(value: unknown): string {
  return apply(objectToString, value, []);
}

type UrlPart =
  | "href"
  | "origin"
  | "protocol"
  | "username"
  | "password"
  | "host"
  | "hostname"
  | "port"
  | "pathname"
  | "search"
  | "hash";

type WritableUrlPart = Exclude<UrlPart, "origin">;

const PARTS: UrlPart[] = [
  "href",
  "origin",
  "protocol",
  "username",
  "password",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
];
const getters: Partial<Record<UrlPart, () => string>> = { __proto__: null } as never;
const setters: Partial<Record<UrlPart, (value: string) => void>> = { __proto__: null } as never;
for (let index = 0; index < PARTS.length; index++) {
  const part = PARTS[index] as UrlPart;
  const descriptor = ownDescriptor(NativeUrl.prototype, part);
  getters[part] = descriptor?.get as () => string;
  setters[part] = descriptor?.set as (value: string) => void;
}

export function urlPart(url: URL, part: UrlPart): string {
  return apply(getters[part] as () => string, url, []);
}

export function setUrlPart(url: URL, part: WritableUrlPart, value: string): void {
  apply(setters[part] as (value: string) => void, url, [value]);
}

export const hrefOf = (url: URL): string => urlPart(url, "href");
export const originOf = (url: URL): string => urlPart(url, "origin");
export const protocolOf = (url: URL): string => urlPart(url, "protocol");
export const hostOf = (url: URL): string => urlPart(url, "host");
export const pathnameOf = (url: URL): string => urlPart(url, "pathname");
export const searchOf = (url: URL): string => urlPart(url, "search");
export const hashOf = (url: URL): string => urlPart(url, "hash");

/** new URL(raw, base) with the native constructor; a URL base is passed as text so its toString is never called. */
export function newUrl(raw: string, base?: string | URL): URL {
  if (base === undefined) return new NativeUrl(raw);
  return new NativeUrl(raw, typeof base === "string" ? base : hrefOf(base));
}

/** Safari 17.4, which the engine supports, has no URL.parse. */
export function parseUrl(raw: string, base?: string | URL): URL | null {
  try {
    return newUrl(raw, base);
  } catch {
    return null;
  }
}

export function isWebUrl(url: URL): boolean {
  const protocol = protocolOf(url);
  return protocol === "http:" || protocol === "https:";
}
