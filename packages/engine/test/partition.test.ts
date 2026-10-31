import { describe, expect, it } from "vitest";
import { partitionOrigin, partitionTop, prefixFor, sameSite } from "../src/shared/partition.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

describe("partitions with built-ins the page replaced", () => {
  const sub = new URL("https://sub.a.test/x");
  const other = new URL("https://b.test/");
  const cases = () => [
    sameSite(sub, "https://a.test"),
    sameSite(other, "https://a.test"),
    partitionOrigin("__g|https://a.test|db"),
    partitionTop("__g^|https://t.test|https://a.test|db"),
    partitionOrigin("__g|x:y|db"),
  ];
  const expected = cases();
  const replaced: Array<[string, object, PropertyKey, PropertyDescriptor]> = [
    ...REPLACED_BUILTINS,
    ["String.prototype.endsWith", String.prototype, "endsWith", { value: () => true }],
    ["URL.prototype.hostname", URL.prototype, "hostname", { get: () => "a.test" }],
  ];
  for (const [name, target, key, replacement] of replaced) {
    it(`keeps partitions apart when ${name} is replaced`, () => {
      expect(withReplaced(target, key, replacement, cases)).toEqual(expected);
    });
  }
});

describe("partition names", () => {
  it("keeps first-party names and marks third-party ones with their top", () => {
    expect(prefixFor("https://a.test")).toBe("__g|https://a.test|");
    expect(prefixFor("https://b.test", "https://a.test")).toBe("__g^|https://a.test|https://b.test|");
    expect(partitionOrigin("__g^|https://a.test|https://b.test|db")).toBe("https://b.test");
    expect(partitionTop("__g^|https://a.test|https://b.test|db")).toBe("https://a.test");
    expect(partitionTop("__g|https://b.test|db")).toBeNull();
  });

  it("reads third-party names strictly", () => {
    expect(partitionOrigin("__g^|null|https://b.test|k")).toBe("https://b.test");
    expect(partitionTop("__g^|null|https://b.test|k")).toBe("null");
    expect(partitionOrigin("__g^|https://a.test|k")).toBeNull();
    expect(partitionOrigin("__g^|javascript:x|https://b.test|k")).toBeNull();
    expect(partitionTop("__g^|https://a.test|garbage|k")).toBeNull();
  });

  it("tells whether a URL belongs to a schemeful site", () => {
    expect(sameSite(new URL("https://www.a.test/x"), "https://a.test")).toBe(true);
    expect(sameSite(new URL("https://a.test:8443/"), "https://a.test")).toBe(true);
    expect(sameSite(new URL("http://a.test/"), "https://a.test")).toBe(false);
    expect(sameSite(new URL("https://xa.test/"), "https://a.test")).toBe(false);
    expect(sameSite(new URL("https://a.test/"), "garbage")).toBe(false);
  });
});
