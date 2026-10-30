import { afterEach, describe, expect, it, vi } from "vitest";
import { installStorageIsolation } from "../src/client/storage-isolation.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { workerBootstrapCode } from "../src/client/worker-bootstrap.ts";
import { installWorker, type WorkerScope } from "../src/client/worker-install.ts";
import { installWorkers } from "../src/client/workers.ts";
import { prefixFor } from "../src/shared/partition.ts";
import { rewriteUrl, unrewriteUrl } from "../src/shared/url-rewrite.ts";
import { recordingCalls } from "./recording-calls.ts";

const ORIGIN = "http://p.test";
const RUNTIME = `${ORIGIN}/_g/worker.X.js`;
const PARTITION = "__g|https://a.test|";

const bootFor = (scriptUrl: string, base: string, module = false) =>
  workerBootstrapCode({ runtimeUrl: RUNTIME, scriptUrl, base, partition: PARTITION, module });

/** Worker-starting, network and storage globals that log what reaches the natives. */
function fakeGlobals() {
  const log: string[] = [];
  const workers: string[] = [];
  const blobs = new Map<string, string>();
  class IDBFactory {
    open(name: string) {
      log.push(`idb:${name}`);
      return {};
    }
    deleteDatabase(name: string) {
      log.push(`idb-del:${name}`);
      return {};
    }
    databases() {
      const names = ["__girici", "__girici_clients", "__girici_prefs", `${PARTITION}db`];
      return Promise.resolve(names.map((name) => ({ name })));
    }
  }
  class CacheStorage {
    open(name: string) {
      log.push(`cache:${name}`);
      return Promise.resolve({});
    }
  }
  class BroadcastChannel {
    constructor(name: string) {
      log.push(`channel:${name}`);
    }
  }
  class Worker {
    constructor(...[url]: [string, unknown?]) {
      workers.push(url);
    }
  }
  class SharedWorker {
    constructor(...[url]: [string, unknown?]) {
      workers.push(url);
    }
  }
  class EventSource {}
  class XMLHttpRequest {
    open(_method: string, url: string) {
      log.push(`xhr:${url}`);
    }
  }
  class Blob {
    readonly parts: string[];
    constructor(parts: string[]) {
      this.parts = parts;
    }
  }
  const globals = {
    IDBFactory,
    indexedDB: new IDBFactory(),
    CacheStorage,
    caches: new CacheStorage(),
    BroadcastChannel,
    Worker,
    SharedWorker,
    EventSource,
    XMLHttpRequest,
    Blob,
    URL: {
      createObjectURL: (blob: Blob) => {
        const url = `blob:${ORIGIN}/${blobs.size + 1}`;
        blobs.set(url, blob.parts.join(""));
        return url;
      },
    },
    fetch: (input: unknown) => {
      log.push(`fetch:${String(input)}`);
      return Promise.resolve();
    },
    importScripts: (...urls: string[]) => {
      for (const url of urls) log.push(`import:${url}`);
    },
    navigator: {
      sendBeacon: (url: string) => {
        log.push(`beacon:${url}`);
        return true;
      },
    },
  };
  return { globals, log, workers, blobs };
}

function workerScope(fake: ReturnType<typeof fakeGlobals>, boot: Record<string, string> = {}) {
  return {
    ...boot,
    location: { origin: ORIGIN, href: `blob:${ORIGIN}/0` },
    eval: (code: string) => code,
    ...fake.globals,
  };
}

function installedScope(boot: Record<string, string> = {}) {
  const fake = fakeGlobals();
  const scope = workerScope(fake, {
    __giriciBase: "https://a.test/w.js",
    __giriciRuntime: RUNTIME,
    __giriciPartition: PARTITION,
    ...boot,
  });
  installWorker(scope as unknown as WorkerScope);
  return { ...fake, scope };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installWorker", () => {
  it("partitions a worker's databases, caches and channels with the page's partition", () => {
    const { scope, log } = installedScope();
    scope.indexedDB.open("db");
    void scope.caches.open("c");
    new scope.BroadcastChannel("c");
    expect(log).toEqual(["idb:__g|https://a.test|db", "cache:__g|https://a.test|c", "channel:__g|https://a.test|c"]);

    const framed = installedScope({ __giriciPartition: "__g^|https://top.test|https://a.test|" });
    framed.scope.indexedDB.open("db");
    expect(framed.log).toEqual(["idb:__g^|https://top.test|https://a.test|db"]);
  });

  it("keeps Girici's own databases out of a worker's reach", async () => {
    const { scope, log } = installedScope();
    scope.indexedDB.deleteDatabase("__girici");
    expect(log).toEqual(["idb-del:__g|https://a.test|__girici"]);
    expect(await scope.indexedDB.databases()).toEqual([{ name: "db" }]);
  });

  it("gives a page's worker the partition the page's own storage uses", () => {
    vi.stubGlobal("__GIRICI_WORKER__", "/_g/worker.X.js");
    const page = fakeGlobals();
    const real = new URL("https://a.test/dir/page");
    const ctx: UrlContext = {
      origin: ORIGIN,
      realUrl: () => real,
      realBase: () => real,
      toProxy: (raw) => rewriteUrl(raw, real, ORIGIN),
      fromProxy: (value) => unrewriteUrl(value, real, ORIGIN),
      inherit: () => {},
    };
    const partition = () => prefixFor(ctx.realUrl().origin);
    const win = page.globals as unknown as Realm;
    installStorageIsolation(win, ctx, partition);
    installWorkers(win, ctx, partition);
    new page.globals.Worker("w.js");

    const worker = fakeGlobals();
    const scope = workerScope(worker);
    const bootstrap = new Function("self", "importScripts", page.blobs.get(page.workers[0] as string) as string);
    bootstrap(scope, () => installWorker(scope as unknown as WorkerScope));
    page.globals.indexedDB.open("db");
    scope.indexedDB.open("db");
    expect(worker.log).toEqual(["idb:__g|https://a.test|db"]);
    expect(page.log).toEqual(worker.log);
  });

  it("gives a nested worker the bootstrap with its real base and this worker's runtime", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker("sub.js");
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(/^blob:/);
    expect(blobs.get(workers[0] as string)).toBe(bootFor(`${ORIGIN}/~/https/a.test/sub.js`, "https://a.test/sub.js"));
  });

  it("gives nested shared and module workers the bootstrap too", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.SharedWorker("shared.js", "name");
    new scope.Worker("mod.js", { type: "module" });
    expect(workers.map((url) => blobs.get(url))).toEqual([
      bootFor(`${ORIGIN}/~/https/a.test/shared.js`, "https://a.test/shared.js"),
      bootFor(`${ORIGIN}/~/https/a.test/mod.js`, "https://a.test/mod.js", true),
    ]);
  });

  it("keeps the worker's own base for a nested blob worker", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker(`blob:${ORIGIN}/inner`);
    new scope.Worker(` BLOB:${ORIGIN}/inner`);
    expect(workers.map((url) => blobs.get(url))).toEqual([
      bootFor(`blob:${ORIGIN}/inner`, "https://a.test/w.js"),
      bootFor(` BLOB:${ORIGIN}/inner`, "https://a.test/w.js"),
    ]);
  });

  it("never hands a native to a replaced call or apply", () => {
    const fake = fakeGlobals();
    const { globals } = fake;
    const natives = [
      globals.fetch,
      globals.importScripts,
      globals.XMLHttpRequest.prototype.open,
      globals.navigator.sendBeacon,
      globals.URL.createObjectURL,
      globals.IDBFactory.prototype.open,
    ];
    const scope = workerScope(fake, { __giriciBase: "https://a.test/w.js", __giriciRuntime: RUNTIME });
    installWorker(scope as unknown as WorkerScope);
    const seen = recordingCalls(() => {
      void scope.fetch("/a");
      scope.importScripts("b.js");
      new scope.XMLHttpRequest().open("GET", "/c");
      scope.navigator.sendBeacon("/d");
      new scope.Worker("e.js");
      scope.indexedDB.open("db");
    });
    expect(natives.filter((native) => seen.includes(native))).toEqual([]);
    expect(fake.log).toEqual([
      `fetch:${ORIGIN}/~/https/a.test/a`,
      `import:${ORIGIN}/~/https/a.test/b.js`,
      `xhr:${ORIGIN}/~/https/a.test/c`,
      `beacon:${ORIGIN}/~/https/a.test/d`,
      "idb:__g|https://a.test|db",
    ]);
    expect(fake.workers).toHaveLength(1);
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
    expect(Object.getPrototypeOf(new scope.SharedWorker("x")).constructor).toBe(scope.SharedWorker);
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
