import { describe, expect, it } from "vitest";
import { createOriginSealer, isSealedPath, MasterSealer, SEALED_PREFIX } from "../src/shared/sealed-address.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const master = new MasterSealer(new Uint8Array(32).fill(7));

describe("sealed addresses", () => {
  it("seals a page into one opaque segment and opens it back", () => {
    const url = new URL("https://www.example.com:8443/a/b?q=1#top");
    const address = master.seal(url);
    expect(address).toMatch(/^\/~\/x\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+#top$/);
    expect(address).not.toContain("example");
    expect(master.seal(url)).toBe(address);
    expect(master.open(address.split("#")[0]!)?.href).toBe("https://www.example.com:8443/a/b?q=1");
    expect(isSealedPath(address)).toBe(true);
    expect(isSealedPath("/~/https/a.test/")).toBe(false);
    expect(SEALED_PREFIX).toBe("/~/x/");
  });

  it("lets a query written after the token replace the page's own", () => {
    const token = master.seal(new URL("https://a.test/p?old=1"));
    expect(master.open(`${token}?page=2`)?.href).toBe("https://a.test/p?page=2");
    expect(master.open(`${token}?`)?.href).toBe("https://a.test/p");
  });

  it("hands a page the key to its own origin only", () => {
    const own = createOriginSealer(master.originSeal("https://a.test"))!;
    const page = new URL("https://a.test/x?y");
    expect(own.origin).toBe("https://a.test");
    expect(own.seal(page)).toBe(master.seal(page));
    expect(master.open(own.seal(new URL("https://a.test/z"))!)?.href).toBe("https://a.test/z");
    expect(own.open(master.seal(new URL("https://a.test/w?v=1")))?.href).toBe("https://a.test/w?v=1");
    expect(own.seal(new URL("https://b.test/"))).toBeNull();
    expect(own.open(master.seal(new URL("https://b.test/")))).toBeNull();
  });

  it("refuses a body moved under another site's label", () => {
    const a = master.seal(new URL("https://a.test/p"));
    const b = master.seal(new URL("https://b.test/p"));
    const label = a.slice("/~/x/".length, a.indexOf("."));
    expect(master.open(`/~/x/${label}.${b.split(".")[1]}`)).toBeNull();
  });

  it("refuses what another key sealed and anything malformed", () => {
    const other = new MasterSealer(new Uint8Array(32).fill(8));
    expect(master.open(other.seal(new URL("https://a.test/")))).toBeNull();
    for (const bad of ["/~/x/", "/~/x/abc", "/~/x/a.b.c", "/~/x/a b.c", "/~/https/a.test/"]) {
      expect(master.open(bad), bad).toBeNull();
    }
    expect(() => master.seal(new URL("ftp://a.test/"))).toThrow(TypeError);
  });

  it("refuses a page seal whose key is not 32 bytes", () => {
    const seal = master.originSeal("https://a.test");
    expect(createOriginSealer({ ...seal, key: "AAAA" })).toBeNull();
    expect(createOriginSealer({ ...seal, key: "not base64!" })).toBeNull();
  });

  it("seals and opens the same while a page has replaced built-ins", () => {
    const own = createOriginSealer(master.originSeal("https://a.test"))!;
    const page = new URL("https://a.test/dir/page?q=1#h");
    const expected = master.seal(page);
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      withReplaced(target, property, replacement, () => {
        expect(own.seal(page), name).toBe(expected);
        expect(own.open(expected.split("#")[0]!) !== null, name).toBe(true);
      });
    }
  });
});
