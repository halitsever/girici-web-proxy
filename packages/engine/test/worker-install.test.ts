import { afterEach, describe, expect, it, vi } from "vitest";
import { installStorageIsolation } from "../src/client/storage-isolation.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { workerBootstrapCode } from "../src/client/worker-bootstrap.ts";
import { installWorker, type WorkerScope } from "../src/client/worker-install.ts";
import { installWorkers } from "../src/client/workers.ts";
import { prefixFor } from "../src/shared/partition.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { rewriteUrl, unrewriteUrl } from "../src/shared/url-rewrite.ts";
import { recordingCalls } from "./recording-calls.ts";

const ORIGIN = "http://p.test";
const RUNTIME = `${ORIGIN}/_g/worker.X.js`;
const PARTITION = "__g|https://a.test|";

const ANNOUNCE = `${ORIGIN}/_g/rpc/worker`;

/** Each bootstrap carries a fresh nonce, so the expected code takes the one the blob holds. */
const bootFor = (code: string | undefined, scriptUrl: string, base: string, module = false) =>
  workerBootstrapCode({ runtimeUrl: RUNTIME, nonce: nonceIn(code), scriptUrl, base, partition: PARTITION, module });

const nonceIn = (code: string | undefined) => /\?n=([A-Za-z0-9_-]+)"/.exec(code ?? "")?.[1] ?? "";

/** Worker-starting, network and storage globals that log what reaches the natives. */
function fakeGlobals() {
  const log: string[] = [];
  const workers: string[] = [];
  const blobs = new Map<string, string>();
  const received: unknown[] = [];
  const inits: unknown[] = [];
  const order: string[] = [];
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
      order.push("worker");
    }
  }
  class SharedWorker {
    constructor(...[url]: [string, unknown?]) {
      workers.push(url);
      order.push("worker");
    }
  }
  class EventSource {}
  class XMLHttpRequest {
    open(_method: string, url: string) {
      log.push(`xhr:${url}`);
    }
  }
  // Like the native, a request keeps its address in an internal slot that only the prototype getter reads.
  const addresses = new WeakMap<object, string>();
  class Request {
    constructor(input: unknown) {
      addresses.set(this, input instanceof Request ? (addresses.get(input) as string) : String(input));
    }
    get url(): string {
      const address = addresses.get(this);
      if (address === undefined) throw new TypeError("Illegal invocation");
      return address;
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
    Request,
    Blob,
    URL: {
      createObjectURL: (blob: Blob) => {
        const url = `blob:${ORIGIN}/${blobs.size + 1}`;
        blobs.set(url, blob.parts.join(""));
        return url;
      },
    },
    fetch: (input: unknown, init?: unknown) => {
      received.push(input);
      inits.push(init);
      const address = typeof input === "object" && input ? addresses.get(input) : String(input);
      log.push(`fetch:${address}`);
      order.push(`fetch:${address}`);
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
  return { globals, log, workers, blobs, received, inits, order };
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
      accepts: () => true,
    };
    const partition = () => prefixFor(ctx.realUrl().origin);
    const win = page.globals as unknown as Realm;
    installStorageIsolation(win, ctx, partition);
    installWorkers(win, ctx, partition, (url, init) => Reflect.apply(win.fetch, win, [url, init]));
    new page.globals.Worker("w.js");

    const worker = fakeGlobals();
    const scope = workerScope(worker);
    const bootstrap = new Function("self", "importScripts", page.blobs.get(page.workers[0] as string) as string);
    bootstrap(scope, () => installWorker(scope as unknown as WorkerScope));
    page.globals.indexedDB.open("db");
    scope.indexedDB.open("db");
    expect(worker.log).toEqual(["idb:__g|https://a.test|db"]);
    expect(page.log).toEqual([`fetch:${ANNOUNCE}`, ...worker.log]);
  });

  it("gives a nested worker the bootstrap with its real base and this worker's runtime", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker("sub.js");
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatch(/^blob:/);
    const code = blobs.get(workers[0] as string);
    expect(code).toBe(bootFor(code, `${ORIGIN}/~/https/a.test/sub.js`, "https://a.test/sub.js"));
  });

  it("gives nested shared and module workers the bootstrap too", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.SharedWorker("shared.js", "name");
    new scope.Worker("mod.js", { type: "module" });
    const [shared, mod] = workers.map((url) => blobs.get(url));
    expect([shared, mod]).toEqual([
      bootFor(shared, `${ORIGIN}/~/https/a.test/shared.js`, "https://a.test/shared.js"),
      bootFor(mod, `${ORIGIN}/~/https/a.test/mod.js`, "https://a.test/mod.js", true),
    ]);
  });

  it("keeps the worker's own base for a nested blob worker", () => {
    const { scope, workers, blobs } = installedScope();
    new scope.Worker(`blob:${ORIGIN}/inner`);
    new scope.Worker(` BLOB:${ORIGIN}/inner`);
    const [plain, upper] = workers.map((url) => blobs.get(url));
    expect([plain, upper]).toEqual([
      bootFor(plain, `blob:${ORIGIN}/inner`, "https://a.test/w.js"),
      bootFor(upper, ` BLOB:${ORIGIN}/inner`, "https://a.test/w.js"),
    ]);
  });

  it("announces a nested worker before starting it", () => {
    const { scope, workers, blobs, inits, order } = installedScope();
    new scope.Worker("sub.js");
    new scope.Worker("sub.js");
    expect(order).toEqual([`fetch:${ANNOUNCE}`, "worker", `fetch:${ANNOUNCE}`, "worker"]);
    const sent = inits.map((init) => {
      const { method, body } = init as { method: string; body: string };
      expect(method).toBe("POST");
      return JSON.parse(body) as { v: number; n: string };
    });
    expect(sent.map(({ v }) => v)).toEqual([PROTOCOL_VERSION, PROTOCOL_VERSION]);
    expect(sent.map(({ n }) => n)).toEqual(workers.map((url) => nonceIn(blobs.get(url))));
    expect(sent[0]?.n).toMatch(/^[0-9a-f]{32}$/);
    expect(sent[0]?.n).not.toBe(sent[1]?.n);
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
      `fetch:${ANNOUNCE}`,
      "idb:__g|https://a.test|db",
    ]);
    expect(fake.workers).toHaveLength(1);
  });

  it("reads a request's address once, through the native getter", () => {
    const { scope, log, received } = installedScope();
    const foreign = new scope.Request("https://evil.test/x");
    let reads = 0;
    // Answers the foreign address first, then its proxied form, so a second read would look already proxied.
    Object.defineProperty(foreign, "url", {
      get: () => (reads++ % 2 === 0 ? "https://evil.test/x" : `${ORIGIN}/~/https/evil.test/x`),
    });
    void scope.fetch(foreign);
    expect(log).toEqual([`fetch:${ORIGIN}/~/https/evil.test/x`]);
    expect(received[0]).not.toBe(foreign);

    const proxied = new scope.Request(`${ORIGIN}/~/https/a.test/y`);
    void scope.fetch(proxied);
    expect(received[1]).toBe(proxied);
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
