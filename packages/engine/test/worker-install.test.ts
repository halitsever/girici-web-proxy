import { describe, expect, it } from "vitest";
import { workerBootstrapCode } from "../src/client/worker-bootstrap.ts";
import { installWorker, type WorkerScope } from "../src/client/worker-install.ts";

const RUNTIME = "http://p.test/_g/worker.X.js";
const PARTITION = "__g|https://a.test|";

function installedScope(boot: Record<string, string> = {}) {
  const opened: string[] = [];
  const channels: string[] = [];
  const workers: string[] = [];
  const blobs = new Map<string, string>();
  class IDBFactory {
    open(name: string) {
      opened.push(`idb:${name}`);
      return {};
    }
    deleteDatabase(name: string) {
      opened.push(`idb-del:${name}`);
      return {};
    }
    databases() {
      const names = ["__girici", "__girici_clients", "__girici_prefs", `${PARTITION}db`];
      return Promise.resolve(names.map((name) => ({ name })));
    }
  }
  class CacheStorage {
    open(name: string) {
      opened.push(`cache:${name}`);
      return Promise.resolve({});
    }
  }
  class BroadcastChannel {
    constructor(name: string) {
      channels.push(name);
    }
  }
  class Worker {
    constructor(url: string) {
      workers.push(url);
    }
  }
  class EventSource {}
  class Blob {
    readonly parts: string[];
    constructor(parts: string[]) {
      this.parts = parts;
    }
  }
  const objectUrls = {
    createObjectURL: (blob: Blob) => {
      const url = `blob:http://p.test/${blobs.size + 1}`;
      blobs.set(url, blob.parts.join(""));
      return url;
    },
  };
  const scope = {
    __giriciBase: "https://a.test/w.js",
    __giriciRuntime: RUNTIME,
    __giriciPartition: PARTITION,
    ...boot,
    location: { origin: "http://p.test", href: "blob:http://p.test/0" },
    eval: (code: string) => code,
    IDBFactory,
    indexedDB: new IDBFactory(),
    CacheStorage,
    caches: new CacheStorage(),
    BroadcastChannel,
    Worker,
    EventSource,
    Blob,
    URL: objectUrls,
  };
  installWorker(scope as unknown as WorkerScope);
  return { scope, opened, channels, workers, blobs };
}

describe("installWorker", () => {
  it("partitions a worker's databases, caches and channels with the page's partition", () => {
    const { scope, opened, channels } = installedScope();
    scope.indexedDB.open("db");
    void scope.caches.open("c");
    new scope.BroadcastChannel("c");
    expect(opened).toEqual(["idb:__g|https://a.test|db", "cache:__g|https://a.test|c"]);
    expect(channels).toEqual(["__g|https://a.test|c"]);

    const framed = installedScope({ __giriciPartition: "__g^|https://top.test|https://a.test|" });
    framed.scope.indexedDB.open("db");
    expect(framed.opened).toEqual(["idb:__g^|https://top.test|https://a.test|db"]);
  });

  it("keeps Girici's own databases out of a worker's reach", async () => {
    const { scope, opened } = installedScope();
    scope.indexedDB.deleteDatabase("__girici");
    expect(opened).toEqual(["idb-del:__g|https://a.test|__girici"]);
    expect(await scope.indexedDB.databases()).toEqual([{ name: "db" }]);
  });

  it("gives a nested worker the bootstrap with its real base and this worker's runtime", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker("sub.js");
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(/^blob:/);
    expect(blobs.get(workers[0] as string)).toBe(
      workerBootstrapCode({
        runtimeUrl: RUNTIME,
        scriptUrl: "http://p.test/~/https/a.test/sub.js",
        base: "https://a.test/sub.js",
        partition: PARTITION,
        module: false,
      }),
    );
  });

  it("keeps the worker's own base for a nested blob worker", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker("blob:http://p.test/inner");
    expect(blobs.get(workers[0] as string)).toBe(
      workerBootstrapCode({
        runtimeUrl: RUNTIME,
        scriptUrl: "blob:http://p.test/inner",
        base: "https://a.test/w.js",
        partition: PARTITION,
        module: false,
      }),
    );
  });

  it("forgets the boot globals after reading them", () => {
    const { scope } = installedScope();
    const globals = scope as Record<string, unknown>;
    expect([globals.__giriciBase, globals.__giriciRuntime, globals.__giriciPartition]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("closes the constructors", () => {
    const { scope } = installedScope();
    expect(Object.getPrototypeOf(new scope.Worker("x")).constructor).toBe(scope.Worker);
    expect(Object.getPrototypeOf(new scope.BroadcastChannel("x")).constructor).toBe(scope.BroadcastChannel);
    expect(Object.getPrototypeOf(new scope.EventSource()).constructor).toBe(scope.EventSource);
  });

  it("leaves a scope it already set up alone", () => {
    const { scope } = installedScope();
    const hooked = scope.Worker;
    installWorker(scope as unknown as WorkerScope);
    expect(scope.Worker).toBe(hooked);
  });
});
