import { describe, expect, it } from "vitest";
import { allowVersionReload } from "../src/client/version.ts";

describe("allowVersionReload", () => {
  it("reloads once per protocol version", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    expect(allowVersionReload(storage, 1)).toBe(true);
    expect(allowVersionReload(storage, 1)).toBe(false);
    expect(allowVersionReload(storage, 2)).toBe(true);
  });
});
