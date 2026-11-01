import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fromBase64Url,
  hmacSha256,
  sha256,
  sivOpen,
  sivSeal,
  TAG_BYTES,
  toBase64Url,
  utf8Bytes,
} from "../src/shared/seal-cipher.ts";
import * as shared from "../src/shared/index.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("seal cipher", () => {
  it("hashes like SHA-256", () => {
    expect(hex(sha256(utf8Bytes("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const size of [0, 55, 56, 63, 64, 65, 1000]) {
      const data = randomBytes(size);
      expect(hex(sha256(data)), String(size)).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("offers the same hash to the UI through the shared entry point", () => {
    expect(shared.sha256).toBe(sha256);
  });

  it("computes HMAC-SHA256 as RFC 4231 and node:crypto do", () => {
    expect(hex(hmacSha256(utf8Bytes("Jefe"), utf8Bytes("what do ya want for nothing?")))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    const key = randomBytes(131);
    const data = randomBytes(300);
    expect(hex(hmacSha256(key, data))).toBe(createHmac("sha256", key).update(data).digest("hex"));
  });

  it("seals deterministically and opens only what it sealed", () => {
    const key = randomBytes(32);
    const ad = utf8Bytes("a");
    const plain = utf8Bytes("/path?q=1");
    const sealed = sivSeal(key, ad, plain);
    expect(sealed.length).toBe(TAG_BYTES + plain.length);
    expect(sivSeal(key, ad, plain)).toEqual(sealed);
    expect(sivOpen(key, ad, sealed)).toEqual(plain);
    for (let index = 0; index < sealed.length; index++) {
      const bad = sealed.slice();
      bad[index]! ^= 1;
      expect(sivOpen(key, ad, bad), String(index)).toBeNull();
    }
    expect(sivOpen(key, utf8Bytes("b"), sealed)).toBeNull();
    expect(sivOpen(randomBytes(32), ad, sealed)).toBeNull();
    expect(sivOpen(key, ad, sealed.slice(0, TAG_BYTES - 1))).toBeNull();
  });

  it("follows the construction it documents", () => {
    const key = randomBytes(32);
    const ad = utf8Bytes("label");
    const plain = randomBytes(70);
    const sealed = sivSeal(key, ad, plain);
    const mac = createHmac("sha256", key).update("girici siv mac").digest();
    const enc = createHmac("sha256", key).update("girici siv enc").digest();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(ad.length);
    const tag = createHmac("sha256", mac).update(length).update(ad).update(plain).digest().subarray(0, 16);
    expect(hex(sealed.subarray(0, 16))).toBe(hex(tag));
    const stream = Buffer.concat(
      [0, 1, 2].map((block) => {
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(block);
        return createHmac("sha256", enc).update(tag).update(counter).digest();
      }),
    );
    const cipher = Buffer.from(plain.map((byte, index) => byte ^ stream[index]!));
    expect(hex(sealed.subarray(16))).toBe(hex(cipher));
  });

  it("encodes UTF-8 and base64url as the platform does", () => {
    for (const text of ["", "ü", "😀", "\ud800x", "x\udc00"]) {
      expect(utf8Bytes(text)).toEqual(new TextEncoder().encode(text));
    }
    for (const size of [0, 1, 2, 3, 41]) {
      const bytes = randomBytes(size);
      expect(toBase64Url(bytes)).toBe(bytes.toString("base64url"));
      expect(fromBase64Url(bytes.toString("base64url"))).toEqual(new Uint8Array(bytes));
    }
    for (const bad of ["a", "ab+c", "ab/c", "ab=c", "a b", "AB", "ABC"]) expect(fromBase64Url(bad), bad).toBeNull();
  });

  it("gives the same token while a page has replaced built-ins", () => {
    const key = new Uint8Array(32).fill(9);
    const expected = toBase64Url(sivSeal(key, utf8Bytes("a"), utf8Bytes("/p?q")));
    const typedArray = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const extra: typeof REPLACED_BUILTINS = [
      ["Math.imul", Math, "imul", { value: () => 0 }],
      ["Uint8Array.prototype.set", typedArray, "set", { value: () => {} }],
      ["TypedArray.prototype.slice", typedArray, "slice", { value: () => new Uint8Array() }],
      ["TypedArray.prototype.subarray", typedArray, "subarray", { value: () => new Uint8Array() }],
      ["TypedArray.prototype.length", typedArray, "length", { get: () => 0 }],
      ["String.prototype.charCodeAt", String.prototype, "charCodeAt", { value: () => 0 }],
      ["String.prototype.codePointAt", String.prototype, "codePointAt", { value: () => 0 }],
      ["String.fromCharCode", String, "fromCharCode", { value: () => "" }],
      ["Array.prototype[Symbol.iterator]", Array.prototype, Symbol.iterator, { value: function* () {} }],
    ];
    for (const [name, target, property, replacement] of [...REPLACED_BUILTINS, ...extra]) {
      withReplaced(target, property, replacement, () => {
        const sealed = sivSeal(key, utf8Bytes("a"), utf8Bytes("/p?q"));
        expect(toBase64Url(sealed), name).toBe(expected);
        const opened = sivOpen(key, utf8Bytes("a"), fromBase64Url(expected)!);
        expect(opened && toBase64Url(opened), name).toBe(toBase64Url(utf8Bytes("/p?q")));
      });
    }
  });
});
