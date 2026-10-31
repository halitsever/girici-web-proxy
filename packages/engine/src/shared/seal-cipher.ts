/**
 * Deterministic authenticated encryption (SIV over HMAC-SHA256) for sealed page addresses. It runs synchronously
 * inside page calls, where WebCrypto is async, so it reads bytes by index and calls only natives taken at load.
 */

import { bytesLength, codePointAt, newBytes } from "./primordials.ts";

export const TAG_BYTES = 16;

const BLOCK = 64;
const HASH = 32;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const NativeInt32Array = Int32Array;

// prettier-ignore
const ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
// prettier-ignore
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const words = new NativeInt32Array(64);
const state = new NativeInt32Array(8);

const at = (bytes: Uint8Array, index: number): number => bytes[index] as number;
const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

export function sha256(data: Uint8Array): Uint8Array {
  const length = bytesLength(data);
  const padded = newBytes((((length + 8) >> 6) + 1) * BLOCK);
  copy(padded, 0, data);
  padded[length] = 0x80;
  const end = bytesLength(padded);
  putU32(padded, end - 8, (length / 0x20000000) >>> 0);
  putU32(padded, end - 4, (length * 8) >>> 0);
  for (let index = 0; index < 8; index++) state[index] = INITIAL[index] as number;
  for (let offset = 0; offset < end; offset += BLOCK) compress(padded, offset);
  const out = newBytes(HASH);
  for (let index = 0; index < 8; index++) putU32(out, index * 4, state[index] as number);
  return out;
}

function compress(bytes: Uint8Array, offset: number): void {
  for (let t = 0; t < 16; t++) {
    const i = offset + t * 4;
    words[t] = (at(bytes, i) << 24) | (at(bytes, i + 1) << 16) | (at(bytes, i + 2) << 8) | at(bytes, i + 3);
  }
  for (let t = 16; t < 64; t++) {
    const w15 = words[t - 15] as number;
    const w2 = words[t - 2] as number;
    const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
    const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
    words[t] = ((words[t - 16] as number) + s0 + (words[t - 7] as number) + s1) | 0;
  }
  let a = state[0] as number;
  let b = state[1] as number;
  let c = state[2] as number;
  let d = state[3] as number;
  let e = state[4] as number;
  let f = state[5] as number;
  let g = state[6] as number;
  let h = state[7] as number;
  for (let t = 0; t < 64; t++) {
    const t1 =
      (h +
        (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
        ((e & f) ^ (~e & g)) +
        (ROUND[t] as number) +
        (words[t] as number)) |
      0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = (state[0] as number) + a;
  state[1] = (state[1] as number) + b;
  state[2] = (state[2] as number) + c;
  state[3] = (state[3] as number) + d;
  state[4] = (state[4] as number) + e;
  state[5] = (state[5] as number) + f;
  state[6] = (state[6] as number) + g;
  state[7] = (state[7] as number) + h;
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const block = newBytes(BLOCK);
  copy(block, 0, bytesLength(key) > BLOCK ? sha256(key) : key);
  const inner = newBytes(BLOCK + bytesLength(data));
  const outer = newBytes(BLOCK + HASH);
  for (let index = 0; index < BLOCK; index++) {
    inner[index] = at(block, index) ^ 0x36;
    outer[index] = at(block, index) ^ 0x5c;
  }
  copy(inner, BLOCK, data);
  copy(outer, BLOCK, sha256(inner));
  return sha256(outer);
}

/** `T ‖ (plain ⊕ HMAC(enc, T ‖ u32be(i))…)`, where T is the first 16 bytes of `HMAC(mac, u32be(|ad|) ‖ ad ‖ plain)`. */
export function sivSeal(key: Uint8Array, ad: Uint8Array, plain: Uint8Array): Uint8Array {
  const tag = tagOf(key, ad, plain);
  const sealed = newBytes(TAG_BYTES + bytesLength(plain));
  copy(sealed, 0, tag);
  xorStream(key, tag, plain, sealed, TAG_BYTES);
  return sealed;
}

export function sivOpen(key: Uint8Array, ad: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  const length = bytesLength(sealed);
  if (length < TAG_BYTES) return null;
  const tag = newBytes(TAG_BYTES);
  const body = newBytes(length - TAG_BYTES);
  for (let index = 0; index < length; index++) {
    if (index < TAG_BYTES) tag[index] = at(sealed, index);
    else body[index - TAG_BYTES] = at(sealed, index);
  }
  const plain = newBytes(length - TAG_BYTES);
  xorStream(key, tag, body, plain, 0);
  const expected = tagOf(key, ad, plain);
  let difference = 0;
  for (let index = 0; index < TAG_BYTES; index++) difference |= at(tag, index) ^ at(expected, index);
  return difference === 0 ? plain : null;
}

function tagOf(key: Uint8Array, ad: Uint8Array, plain: Uint8Array): Uint8Array {
  const adLength = bytesLength(ad);
  const input = newBytes(4 + adLength + bytesLength(plain));
  putU32(input, 0, adLength);
  copy(input, 4, ad);
  copy(input, 4 + adLength, plain);
  const full = hmacSha256(subkey(key, MAC_LABEL), input);
  const tag = newBytes(TAG_BYTES);
  for (let index = 0; index < TAG_BYTES; index++) tag[index] = at(full, index);
  return tag;
}

function xorStream(key: Uint8Array, tag: Uint8Array, from: Uint8Array, to: Uint8Array, offset: number): void {
  const enc = subkey(key, ENC_LABEL);
  const counter = newBytes(TAG_BYTES + 4);
  copy(counter, 0, tag);
  const length = bytesLength(from);
  let stream = newBytes(0);
  for (let index = 0; index < length; index++) {
    if (index % HASH === 0) {
      putU32(counter, TAG_BYTES, index / HASH);
      stream = hmacSha256(enc, counter);
    }
    to[offset + index] = at(from, index) ^ at(stream, index % HASH);
  }
}

const MAC_LABEL = utf8Bytes("girici siv mac");
const ENC_LABEL = utf8Bytes("girici siv enc");

function subkey(key: Uint8Array, label: Uint8Array): Uint8Array {
  return hmacSha256(key, label);
}

/** Encodes as TextEncoder does, a lone surrogate becoming U+FFFD. */
export function utf8Bytes(text: string): Uint8Array {
  let size = 0;
  for (let index = 0; index < text.length;) {
    const point = pointAt(text, index);
    index += point > 0xffff ? 2 : 1;
    size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  const bytes = newBytes(size);
  let length = 0;
  for (let index = 0; index < text.length;) {
    const point = pointAt(text, index);
    index += point > 0xffff ? 2 : 1;
    if (point < 0x80) {
      bytes[length++] = point;
    } else if (point < 0x800) {
      bytes[length++] = 0xc0 | (point >> 6);
      bytes[length++] = 0x80 | (point & 0x3f);
    } else if (point < 0x10000) {
      bytes[length++] = 0xe0 | (point >> 12);
      bytes[length++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[length++] = 0x80 | (point & 0x3f);
    } else {
      bytes[length++] = 0xf0 | (point >> 18);
      bytes[length++] = 0x80 | ((point >> 12) & 0x3f);
      bytes[length++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[length++] = 0x80 | (point & 0x3f);
    }
  }
  return bytes;
}

function pointAt(text: string, index: number): number {
  const point = codePointAt(text, index) ?? 0;
  return point >= 0xd800 && point <= 0xdfff ? 0xfffd : point;
}

export function toBase64Url(bytes: Uint8Array): string {
  const length = bytesLength(bytes);
  let text = "";
  for (let index = 0; index < length; index += 3) {
    const left = length - index;
    const chunk =
      (at(bytes, index) << 16) | (left > 1 ? at(bytes, index + 1) << 8 : 0) | (left > 2 ? at(bytes, index + 2) : 0);
    text += (ALPHABET[(chunk >> 18) & 63] as string) + (ALPHABET[(chunk >> 12) & 63] as string);
    if (left > 1) text += ALPHABET[(chunk >> 6) & 63] as string;
    if (left > 2) text += ALPHABET[chunk & 63] as string;
  }
  return text;
}

/** Null for any character outside the URL-safe alphabet or for a non-canonical tail, so each value has one spelling. */
export function fromBase64Url(text: string): Uint8Array | null {
  const length = text.length;
  const tail = length % 4;
  if (tail === 1) return null;
  const bytes = newBytes(((length - tail) / 4) * 3 + (tail ? tail - 1 : 0));
  let out = 0;
  let bits = 0;
  let held = 0;
  for (let index = 0; index < length; index++) {
    const value = sextet(codePointAt(text, index) ?? -1);
    if (value < 0) return null;
    bits = (bits << 6) | value;
    held += 6;
    if (held >= 8) {
      held -= 8;
      bytes[out++] = (bits >> held) & 0xff;
      bits &= (1 << held) - 1;
    }
  }
  return bits === 0 ? bytes : null;
}

function sextet(point: number): number {
  if (point >= 0x41 && point <= 0x5a) return point - 0x41;
  if (point >= 0x61 && point <= 0x7a) return point - 0x61 + 26;
  if (point >= 0x30 && point <= 0x39) return point - 0x30 + 52;
  if (point === 0x2d) return 62;
  if (point === 0x5f) return 63;
  return -1;
}

function copy(to: Uint8Array, offset: number, from: Uint8Array): void {
  const length = bytesLength(from);
  for (let index = 0; index < length; index++) to[offset + index] = at(from, index);
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
