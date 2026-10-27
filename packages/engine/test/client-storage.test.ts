import { describe, expect, it } from "vitest";
import { createPartitionedStorage } from "../src/client/storage.ts";

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.#items.set(key, String(value));
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  clear() {
    this.#items.clear();
  }
}

describe("createPartitionedStorage", () => {
  it("keeps each site's keys apart", () => {
    const native = new MemoryStorage();
    const a = createPartitionedStorage(native, "https://a.test");
    const b = createPartitionedStorage(native, "https://b.test");
    a.setItem("k", "1");
    b.setItem("k", "2");
    expect([a.getItem("k"), b.getItem("k")]).toEqual(["1", "2"]);
    expect(native.getItem("__g|https://a.test|k")).toBe("1");
    expect([a.length, a.key(0)]).toEqual([1, "k"]);
  });

  it("supports property access, enumeration and clear", () => {
    const native = new MemoryStorage();
    const a = createPartitionedStorage(native, "https://a.test") as Storage & Record<string, string>;
    const b = createPartitionedStorage(native, "https://b.test");
    a.color = "red";
    b.setItem("other", "x");
    expect(a.color).toBe("red");
    expect(Object.keys(a)).toEqual(["color"]);
    expect("color" in a).toBe(true);
    delete a.color;
    expect(a.getItem("color")).toBeNull();
    a.setItem("x", "1");
    a.clear();
    expect(a.length).toBe(0);
    expect(b.getItem("other")).toBe("x");
  });

  it("stores values as strings", () => {
    const a = createPartitionedStorage(new MemoryStorage(), "https://a.test");
    a.setItem("n", 5 as unknown as string);
    expect(a.getItem("n")).toBe("5");
  });
});
