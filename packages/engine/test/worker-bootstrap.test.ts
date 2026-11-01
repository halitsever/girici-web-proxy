import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { hookWorkers, type WorkerGlobals } from "../src/client/worker-bootstrap.ts";
import { workerBootstrapCode } from "../src/shared/worker-boot.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const boot = {
  runtimeUrl: "http://p.test/_g/worker.X.js",
  nonce: "0123456789abcdef0123456789abcdef",
  scriptUrl: "http://p.test/~/https/a.test/w.js",
  base: "https://a.test/w.js",
  partition: "__g|https://a.test|",
};

describe("workerBootstrapCode", () => {
  it("loads the runtime first with the worker's base, runtime URL and partition", () => {
    expect(workerBootstrapCode({ ...boot, module: false })).toBe(
      'self.__giriciBase="https://a.test/w.js";self.__giriciRuntime="http://p.test/_g/worker.X.js";' +
        'self.__giriciPartition="__g|https://a.test|";' +
        'importScripts("http://p.test/_g/worker.X.js?n=0123456789abcdef0123456789abcdef",' +
        '"http://p.test/~/https/a.test/w.js");',
    );
    expect(workerBootstrapCode({ ...boot, module: true })).toContain(
      'await import("http://p.test/_g/worker.X.js?n=0123456789abcdef0123456789abcdef");' +
        'await import("http://p.test/~/https/a.test/w.js");',
    );
  });
});

/** Reads its parts and options as WebIDL does, so it consults whatever the page left on the prototypes. */
class FakeBlob {
  readonly text: string;
  readonly endings: unknown;
  constructor(parts: Iterable<string>, options?: { type?: string; endings?: unknown }) {
    let text = "";
    for (const part of parts) text += part;
    this.text = text;
    this.endings = options?.endings;
  }
}

function startWorker() {
  const blobs: FakeBlob[] = [];
  const announced: Array<Record<string, unknown>> = [];
  const globals = {
    Worker: class {},
    URL: {
      createObjectURL: (blob: unknown) => {
        blobs.push(blob as FakeBlob);
        return "blob:http://p.test/1";
      },
    },
    Blob: FakeBlob,
  };
  hookWorkers(globals as unknown as WorkerGlobals, {
    runtimeUrl: boot.runtimeUrl,
    origin: "http://p.test",
    fetch: (_url, init) => {
      announced.push(init as Record<string, unknown>);
      return Promise.resolve();
    },
    partition: () => boot.partition,
    blobBase: () => "https://a.test/",
    resolve: (raw) => ({ scriptUrl: `http://p.test/~/https/a.test/${raw}`, base: `https://a.test/${raw}` }),
  });
  return { blobs, announced, Worker: globals.Worker as new (url: string) => object };
}

describe("hookWorkers", () => {
  function tampered(setup: () => () => void): FakeBlob {
    const { blobs, Worker } = startWorker();
    const restore = setup();
    try {
      new Worker("w.js");
    } finally {
      restore();
    }
    expect(blobs).toHaveLength(1);
    return blobs[0]!;
  }

  it("builds the bootstrap blob whatever the page did to the array iterator", () => {
    const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    const blob = tampered(() => {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        ...original,
        value: function* () {
          yield "page code";
        },
      });
      return () => Object.defineProperty(Array.prototype, Symbol.iterator, original);
    });
    expect(blob.text).toContain("importScripts(");
    expect(blob.text).not.toContain("page code");
  });

  it("builds the bootstrap blob whatever the page did to the array iterator's next", () => {
    const iterator = Object.getPrototypeOf([][Symbol.iterator]()) as { next: unknown };
    const original = Object.getOwnPropertyDescriptor(iterator, "next")!;
    const blob = tampered(() => {
      const done = new WeakSet<object>();
      Object.defineProperty(iterator, "next", {
        ...original,
        value(this: object) {
          if (done.has(this)) return { value: undefined, done: true };
          done.add(this);
          return { value: "page code", done: false };
        },
      });
      return () => Object.defineProperty(iterator, "next", original);
    });
    expect(blob.text).toContain("importScripts(");
    expect(blob.text).not.toContain("page code");
  });

  it("builds the bootstrap blob whatever the page added to Object.prototype", () => {
    const proto = Object.prototype as Record<string, unknown>;
    const blob = tampered(() => {
      proto.endings = "native";
      proto.value = "page code";
      proto.done = false;
      return () => {
        delete proto.endings;
        delete proto.value;
        delete proto.done;
      };
    });
    expect(blob.text).not.toContain("page code");
    expect(blob.endings).toBeUndefined();
  });

  it("announces a random hex nonce in a body and init the page cannot shape", () => {
    const { blobs, announced, Worker } = startWorker();
    const proto = Object.prototype as Record<string, unknown>;
    const strings = String.prototype as unknown as Record<symbol, unknown>;
    const replace = Object.getOwnPropertyDescriptor(String.prototype, Symbol.replace);
    proto.toJSON = () => ({ v: 0, n: "page" });
    proto.headers = { "x-page": "1" };
    strings[Symbol.replace] = () => "pagechosennoncepagechosennonce";
    try {
      new Worker("w.js");
    } finally {
      delete proto.toJSON;
      delete proto.headers;
      if (replace) Object.defineProperty(String.prototype, Symbol.replace, replace);
      else delete strings[Symbol.replace];
    }
    const init = announced[0]!;
    expect(Object.getPrototypeOf(init)).toBeNull();
    expect(init.headers).toBeUndefined();
    const body = JSON.parse(init.body as string) as { v: number; n: string };
    expect(body.v).toBe(PROTOCOL_VERSION);
    expect(body.n).toMatch(/^[0-9a-f]{32}$/);
    expect(blobs[0]!.text).toContain(`?n=${body.n}`);
  });
});

/** A window realm whose SharedWorker records what the hook hands the native constructor. */
function sharedRealm(partition: string) {
  const started: unknown[][] = [];
  const announced: string[] = [];
  const announcedBeforeStart: number[] = [];
  const blobs: FakeBlob[] = [];
  const globals: WorkerGlobals = {
    SharedWorker: class {
      constructor(...args: unknown[]) {
        announcedBeforeStart.push(announced.length);
        started.push(args);
      }
    },
    URL: {
      createObjectURL: (blob: unknown) => {
        blobs.push(blob as FakeBlob);
        return "blob:http://proxy.test/1";
      },
    },
    Blob: FakeBlob as unknown as WorkerGlobals["Blob"],
  };
  hookWorkers(globals, {
    runtimeUrl: "http://proxy.test/_g/worker.X.js",
    origin: "http://proxy.test",
    fetch: (_url, init) => {
      announced.push((init as { body: string }).body);
      return Promise.resolve();
    },
    partition: () => partition,
    blobBase: () => "https://site-a.test/",
    // Indexing only, so the fake keeps working while a test replaces string methods.
    resolve: (raw) =>
      raw[0] === "/"
        ? { scriptUrl: `http://proxy.test/~/https/site-a.test${raw}`, base: `https://site-a.test${raw}` }
        : { scriptUrl: raw, base: raw },
  });
  return { globals, started, announced, announcedBeforeStart, blobs };
}

const SITE_A = "__g|https://site-a.test|";
const sharedAddress =
  "http://proxy.test/_g/rpc/shared-worker?s=" +
  encodeURIComponent("http://proxy.test/~/https/site-a.test/shared.js") +
  "&p=" +
  encodeURIComponent(SITE_A) +
  "&t=classic";
const sharedPath = sharedAddress.slice("http://proxy.test".length);

describe("hookWorkers for shared workers", () => {
  it("starts a shared worker from one address per script, partition and type", () => {
    const a = sharedRealm(SITE_A);
    const b = sharedRealm(SITE_A);
    const other = sharedRealm("__g|https://site-b.test|");
    new a.globals.SharedWorker!("/shared.js", { name: "x" });
    new b.globals.SharedWorker!("/shared.js", { name: "x" });
    new other.globals.SharedWorker!("/shared.js");
    new a.globals.SharedWorker!("/shared.js", { type: "module" });
    expect(a.started[0]).toEqual([sharedAddress, { name: "x" }]);
    expect(b.started[0]![0]).toBe(sharedAddress);
    expect(other.started[0]![0]).not.toBe(sharedAddress);
    expect(a.started[1]![0]).toBe(sharedAddress.replace("t=classic", "t=module"));
    expect(a.blobs).toEqual([]);
  });

  it("announces the shared start before making it", () => {
    const realm = sharedRealm(SITE_A);
    new realm.globals.SharedWorker!("/shared.js");
    expect(realm.announcedBeforeStart).toEqual([1]);
    expect(JSON.parse(realm.announced[0]!)).toEqual({
      v: PROTOCOL_VERSION,
      n: expect.stringMatching(/^[0-9a-f]{32}$/),
      w: sharedPath,
    });
  });

  it("keeps a blob shared worker on its own bootstrap blob", () => {
    const realm = sharedRealm(SITE_A);
    new realm.globals.SharedWorker!("blob:http://proxy.test/inner");
    expect(realm.started[0]![0]).toBe("blob:http://proxy.test/1");
    expect(realm.blobs[0]!.text).toContain('"blob:http://proxy.test/inner"');
    expect(JSON.parse(realm.announced[0]!)).not.toHaveProperty("w");
  });

  it("keeps a shared worker whose script is not proxied on its own bootstrap blob", () => {
    const realm = sharedRealm(SITE_A);
    new realm.globals.SharedWorker!("data:text/javascript,onconnect=null");
    expect(realm.started[0]![0]).toBe("blob:http://proxy.test/1");
    expect(JSON.parse(realm.announced[0]!)).not.toHaveProperty("w");
  });

  describe("builds the shared address whatever the page replaced", () => {
    const replaced: Array<[string, object, PropertyKey, PropertyDescriptor]> = [
      ...REPLACED_BUILTINS,
      ["encodeURIComponent", globalThis, "encodeURIComponent", { value: () => "page" }],
      ["JSON.stringify", JSON, "stringify", { value: () => '"page"' }],
    ];
    for (const [name, target, key, replacement] of replaced) {
      it(`with ${name} replaced`, () => {
        const realm = sharedRealm(SITE_A);
        withReplaced(target, key, replacement, () => new realm.globals.SharedWorker!("/shared.js"));
        expect(realm.started[0]![0]).toBe(sharedAddress);
        expect((JSON.parse(realm.announced[0]!) as { w: string }).w).toBe(sharedPath);
      });
    }
  });
});
