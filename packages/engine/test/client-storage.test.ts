import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createPartitionedStorage, installStorage, partitionFor } from "../src/client/storage.ts";
import { spyBuiltins } from "./spied-builtins.ts";
import type { Realm } from "../src/client/url-context.ts";
import { prefixFor } from "../src/shared/partition.ts";

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
    const a = createPartitionedStorage(native, prefixFor("https://a.test"));
    const b = createPartitionedStorage(native, prefixFor("https://b.test"));
    a.setItem("k", "1");
    b.setItem("k", "2");
    expect([a.getItem("k"), b.getItem("k")]).toEqual(["1", "2"]);
    expect(native.getItem("__g|https://a.test|k")).toBe("1");
    expect([a.length, a.key(0)]).toEqual([1, "k"]);
  });

  it("supports property access, enumeration and clear", () => {
    const native = new MemoryStorage();
    const a = createPartitionedStorage(native, prefixFor("https://a.test")) as Storage & Record<string, string>;
    const b = createPartitionedStorage(native, prefixFor("https://b.test"));
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

  it("reads the page's key index once", () => {
    const a = createPartitionedStorage(new MemoryStorage(), prefixFor("https://a.test"));
    a.setItem("k", "1");
    let reads = 0;
    const index = {
      valueOf() {
        reads++;
        return 0;
      },
      toString() {
        reads++;
        return "0";
      },
    };
    expect(a.key(index as unknown as number)).toBe("k");
    expect(reads).toBe(1);
  });

  it("stores values as strings", () => {
    const a = createPartitionedStorage(new MemoryStorage(), prefixFor("https://a.test"));
    a.setItem("n", 5 as unknown as string);
    expect(a.getItem("n")).toBe("5");
  });

  it("never hands the raw store to a replaced Storage method", () => {
    const native = new MemoryStorage();
    native.setItem("__g|https://b.test|secret", "b");
    const a = createPartitionedStorage(native, prefixFor("https://a.test"));
    const proto = MemoryStorage.prototype as unknown as Record<string, unknown>;
    const original = proto.getItem;
    const seen: unknown[] = [];
    proto.getItem = function (this: unknown) {
      seen.push(this);
      return null;
    };
    try {
      expect(a.getItem("x")).toBeNull();
      expect((a as unknown as Record<string, unknown>).x).toBeUndefined();
    } finally {
      proto.getItem = original;
    }
    expect(seen).toEqual([]);
  });

  it("shows no raw store or foreign key to globals a page replaced before its first access", () => {
    const native = new MemoryStorage();
    native.setItem("__g|https://b.test|secret", "b");
    const seen: unknown[] = [];
    const getPrototypeOf = Object.getPrototypeOf;
    const startsWith = String.prototype.startsWith;
    Object.getPrototypeOf = (value: unknown) => (seen.push(value), getPrototypeOf(value));
    String.prototype.startsWith = function (this: string, search: string) {
      seen.push(String(this));
      return Reflect.apply(startsWith, this, [search]);
    };
    try {
      const a = createPartitionedStorage(native, prefixFor("https://a.test"));
      a.setItem("own", "1");
      expect(Object.keys(a)).toEqual(["own"]);
    } finally {
      Object.getPrototypeOf = getPrototypeOf;
      String.prototype.startsWith = startsWith;
    }
    expect(seen).toEqual([]);
  });

  it("keeps a window's storage away from the built-ins of the realm that made its runtime", async () => {
    // The window's own Storage, from another realm than the runtime's, as in a window the browser reused.
    const PageStorage = runInNewContext(`(class Storage {
      #items = new Map();
      get length() { return this.#items.size; }
      key(index) { return [...this.#items.keys()][index] ?? null; }
      getItem(key) { return this.#items.get(key) ?? null; }
      setItem(key, value) { this.#items.set(key, String(value)); }
      removeItem(key) { this.#items.delete(key); }
    })`) as new () => Storage;
    const native = new PageStorage();
    const prefix = prefixFor("https://a.test");
    native.setItem(`${prefix}s3cr3tk`, "s3cr3tv");
    const ownDescriptorOf = Reflect.getOwnPropertyDescriptor;
    const keysOf = Reflect.ownKeys;
    const out: unknown[] = [0, 0, 0, 0, 0, 0, 0];
    const seen = await spyBuiltins("s3cr3t", () => {
      const storage = createPartitionedStorage(native, prefix) as Storage & Record<string, unknown>;
      out[0] = storage.s3cr3tk;
      out[1] = storage.getItem("s3cr3tk");
      out[2] = ownDescriptorOf(storage, "s3cr3tk");
      out[3] = storage.key(3);
      out[4] = keysOf(storage);
      out[5] = storage.length;
      out[6] = storage.constructor === PageStorage;
    });
    expect(seen).toEqual([]);
    expect(out).toEqual([
      "s3cr3tv",
      "s3cr3tv",
      { value: "s3cr3tv", writable: true, enumerable: true, configurable: true },
      null,
      ["s3cr3tk"],
      1,
      true,
    ]);
  });

  it("ignores proxy traps a page adds to Object.prototype", () => {
    const a = createPartitionedStorage(new MemoryStorage(), prefixFor("https://a.test"));
    const proto = Object.prototype as Record<string, unknown>;
    let trapped = false;
    proto.getPrototypeOf = () => {
      trapped = true;
      return null;
    };
    try {
      Object.getPrototypeOf(a);
    } finally {
      delete proto.getPrototypeOf;
    }
    expect(trapped).toBe(false);
  });
});

describe("partitionFor", () => {
  it("treats a same-site frame as first-party and partitions the rest by top", () => {
    const frame = (topUrl: string, site: string, origin: string) =>
      partitionFor({ origin, isTop: false, topUrl: new URL(topUrl), site });
    expect(frame("https://www.a.test/", "https://a.test", "https://login.a.test")).toBe("__g|https://login.a.test|");
    expect(frame("https://evil.test/", "https://a.test", "https://a.test")).toBe(
      "__g^|https://evil.test|https://a.test|",
    );
    expect(frame("http://a.test/", "https://a.test", "https://a.test")).toBe("__g^|http://a.test|https://a.test|");
    expect(partitionFor({ origin: "https://a.test", isTop: true, topUrl: null, site: undefined })).toBe(
      "__g|https://a.test|",
    );
  });

  it("does not take a frame's claimed site for first-party storage unless its host and its top agree", () => {
    const frame = (origin: string, site: string, topSite?: string) =>
      partitionFor({ origin, isTop: false, topUrl: new URL("https://www.a.test/"), site, topSite });
    // A b.test frame in an a.test top that claims a.test is still third-party.
    expect(frame("https://b.test", "https://a.test")).toBe("__g^|https://www.a.test|https://b.test|");
    // The top's own runtime names another site.
    expect(frame("https://login.a.test", "https://a.test", "https://c.test")).toBe(
      "__g^|https://www.a.test|https://login.a.test|",
    );
    expect(frame("https://login.a.test", "https://a.test", "https://a.test")).toBe("__g|https://login.a.test|");
    expect(frame("https://login.a.test", "https://a.test")).toBe("__g|https://login.a.test|");
  });

  it("partitions a frame whose top or site is unknown", () => {
    expect(partitionFor({ origin: "https://a.test", isTop: false, topUrl: null, site: "https://a.test" })).toBe(
      "__g^|null|https://a.test|",
    );
    expect(
      partitionFor({ origin: "https://a.test", isTop: false, topUrl: new URL("https://a.test/"), site: undefined }),
    ).toBe("__g^|https://a.test|https://a.test|");
  });
});

describe("storage events", () => {
  function setup() {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const listeners: Array<[string, (event: unknown) => void, unknown]> = [];
    interface RawEvent {
      key: string | null;
      oldValue: string | null;
      newValue: string | null;
      area: Storage;
    }
    class StorageEvent {
      readonly isTrusted: boolean;
      readonly raw: RawEvent;
      stopped = false;
      constructor(raw: RawEvent, trusted = true) {
        this.raw = raw;
        this.isTrusted = trusted;
      }
      get key() {
        return this.raw.key;
      }
      get oldValue() {
        return this.raw.oldValue;
      }
      get newValue() {
        return this.raw.newValue;
      }
      get storageArea() {
        return this.raw.area;
      }
    }
    const win = {
      Storage: { prototype: MemoryStorage.prototype },
      StorageEvent,
      Event: {
        prototype: {
          stopImmediatePropagation(this: { stopped: boolean }) {
            this.stopped = true;
          },
        },
      },
      addEventListener(type: string, listener: (event: unknown) => void, capture: unknown) {
        listeners.push([type, listener, capture]);
      },
    } as unknown as Realm & Record<string, Storage>;
    Object.defineProperty(win, "localStorage", { configurable: true, get: () => local });
    Object.defineProperty(win, "sessionStorage", { configurable: true, get: () => session });
    const events = installStorage(win, () => prefixFor("https://a.test"));
    events.listen();
    const event = (key: string | null, trusted = true) =>
      new StorageEvent({ key, oldValue: "old", newValue: "new", area: local }, trusted) as unknown as {
        key: string | null;
        oldValue: string | null;
        newValue: string | null;
        storageArea: unknown;
        stopped: boolean;
      };
    const dispatch = (target: ReturnType<typeof event>) => {
      for (const [type, listener] of listeners) if (type === "storage") listener(target);
      return target.stopped;
    };
    return { win, event, dispatch, listeners };
  }

  it("shows a change in the window's own partition without the prefix", () => {
    const { win, event, dispatch } = setup();
    const own = event("__g|https://a.test|k");
    expect(dispatch(own)).toBe(false);
    expect([own.key, own.oldValue, own.newValue]).toEqual(["k", "old", "new"]);
    expect(own.storageArea).toBe(win.localStorage);
  });

  it("drops another partition's change before page listeners and hides its key and values", () => {
    const { event, dispatch, listeners } = setup();
    expect(listeners.map(([type, , capture]) => [type, capture])).toEqual([["storage", true]]);
    for (const key of ["__g|https://b.test|k", "__g^|https://b.test|https://a.test|k", null]) {
      const foreign = event(key);
      expect(dispatch(foreign)).toBe(true);
      expect([foreign.key, foreign.oldValue, foreign.newValue]).toEqual([null, null, null]);
    }
  });

  it("leaves an event the page made itself as it made it", () => {
    const { event, dispatch } = setup();
    const made = event("k", false);
    expect(dispatch(made)).toBe(false);
    expect([made.key, made.newValue]).toEqual(["k", "new"]);
  });
});
