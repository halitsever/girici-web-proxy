import { describe, expect, it } from "vitest";
import type { ClientRecordStore } from "../src/sw/client-records.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { answerAnnouncement, readAnnouncement, readNonce, WorkerRegistry } from "../src/sw/worker-identity.ts";

function memoryRecords(): ClientRecordStore & { stores: Record<"ui" | "workers", Map<string, unknown>> } {
  const stores = { ui: new Map<string, unknown>(), workers: new Map<string, unknown>() };
  return {
    stores,
    load: async (store) => [...stores[store]].map(([key, value]) => ({ key, value })),
    put: async (store, key, value) => void stores[store].set(key, value),
    delete: async (store, key) => void stores[store].delete(key),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const id = { page: "https://a.test/app", top: "https://a.test" };
const nonce = "n".repeat(32);

describe("WorkerRegistry", () => {
  it("binds a worker to the window that announced it", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    await workers.ready();
    workers.announce(nonce, id, "page");
    expect(await workers.claim("w1", nonce)).toEqual(id);
    expect(await workers.identityOf("w1")).toEqual(id);
  });

  it("waits briefly for an announcement that arrives after the worker's first request", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 200 });
    await workers.ready();
    const claimed = workers.claim("w1", nonce);
    const pending = workers.identityOf("w1");
    setTimeout(() => workers.announce(nonce, id, "page"), 20);
    expect(await claimed).toEqual(id);
    expect(await pending).toEqual(id);
  });

  it("uses a nonce once and forgets one nobody claimed", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 10, ttlMs: 50 });
    await workers.ready();
    workers.announce(nonce, id, "page");
    expect(await workers.claim("w1", nonce)).toEqual(id);
    expect(await workers.claim("w2", nonce)).toBeNull();
    workers.announce("m".repeat(32), id, "page", 0);
    expect(await workers.claim("w3", "m".repeat(32))).toBeNull(); // claimed at Date.now(), long after ttl
  });

  it("remembers a worker's site after the service worker restarts", async () => {
    const records = memoryRecords();
    const before = new WorkerRegistry(records);
    await before.ready();
    before.announce(nonce, id, "page");
    await before.claim("w1", nonce);
    await flush();
    const after = new WorkerRegistry(records);
    await after.ready();
    expect(await after.identityOf("w1")).toEqual(id);
  });

  it("knows nothing of a worker that never claimed a nonce", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    await workers.ready();
    expect(await workers.identityOf("w1")).toBeNull();
  });

  it("keeps a worker's first binding", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    await workers.ready();
    workers.announce(nonce, id, "page");
    await workers.claim("w1", nonce);
    const other = { page: "https://b.test/", top: "https://b.test" };
    workers.announce("m".repeat(32), other, "page");
    expect(await workers.claim("w1", "m".repeat(32))).toEqual(id);
    expect(await workers.identityOf("w1")).toEqual(id);
  });
});

describe("WorkerRegistry limits and storage", () => {
  const nonceOf = (index: number) => index.toString(16).padStart(32, "0");

  it("caps one client's unclaimed nonces, so it cannot push out another's", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 10, limit: 8, perClient: 4 });
    await workers.ready();
    workers.announce(nonce, id, "victim");
    for (let index = 0; index < 20; index++) workers.announce(nonceOf(index), id, "flooder");
    expect(await workers.claim("w1", nonce)).toEqual(id);
    expect(await workers.claim("w2", nonceOf(19))).toEqual(id);
    expect(await workers.claim("w3", nonceOf(0))).toBeNull();
  });

  it("evicts from the client holding the most nonces once every client is at its cap", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 10, limit: 4, perClient: 3 });
    await workers.ready();
    workers.announce(nonce, id, "victim");
    for (const client of ["a", "b"])
      for (let index = 0; index < 3; index++) workers.announce(`${client}${nonceOf(index).slice(1)}`, id, client);
    expect(await workers.claim("w1", nonce)).toEqual(id);
  });

  it("keeps at most the limit of bindings, dropping the least recently used", async () => {
    const records = memoryRecords();
    const workers = new WorkerRegistry(records, { limit: 2 });
    await workers.ready();
    for (const [index, client] of ["w1", "w2"].entries()) {
      workers.announce(nonceOf(index), id, "page");
      await workers.claim(client, nonceOf(index));
    }
    // A worker still making requests is not the one to go.
    await workers.identityOf("w1");
    workers.announce(nonceOf(2), id, "page");
    await workers.claim("w3", nonceOf(2));
    expect(await workers.identityOf("w1")).toEqual(id);
    expect(await workers.identityOf("w2")).toBeNull();
    expect([...records.stores.workers.keys()].sort()).toEqual(["w1", "w3"]);
  });

  it("settles a claim only once its binding is stored", async () => {
    const records = memoryRecords();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const workers = new WorkerRegistry({ ...records, put: async (...args) => (await gate, records.put(...args)) });
    await workers.ready();
    workers.announce(nonce, id, "page");
    let settled = false;
    const claimed = workers.claim("w1", nonce).then(() => (settled = true));
    // The worker's own requests do not wait for the disk.
    expect(await workers.identityOf("w1")).toEqual(id);
    expect(settled).toBe(false);
    release();
    await claimed;
    expect(records.stores.workers.has("w1")).toBe(true);
  });

  it("reads stored bindings before taking a nonce for a worker it already knows", async () => {
    const records = memoryRecords();
    records.stores.workers.set("w1", { ...id, at: 1 });
    const workers = new WorkerRegistry(records, { waitMs: 10 });
    workers.announce(nonce, { page: "https://b.test/", top: "https://b.test" }, "page");
    expect(await workers.claim("w1", nonce)).toEqual(id);
  });

  it("drops stored bindings that are malformed or name no URL", async () => {
    const records = memoryRecords();
    records.stores.workers.set("w1", { page: "not a url", top: null, at: 1 });
    records.stores.workers.set("w2", { page: 5, top: null });
    records.stores.workers.set("w3", { ...id, at: 2 });
    const workers = new WorkerRegistry(records);
    expect(await workers.identityOf("w1")).toBeNull();
    expect(await workers.identityOf("w2")).toBeNull();
    expect(await workers.identityOf("w3")).toEqual(id);
  });

  it("reads again after a failed load", async () => {
    const records = memoryRecords();
    records.stores.workers.set("w1", { ...id, at: 1 });
    let failures = 1;
    const workers = new WorkerRegistry({
      ...records,
      load: async (store) => {
        if (failures-- > 0) throw new Error("blocked");
        return records.load(store);
      },
    });
    expect(await workers.identityOf("w1")).toBeNull();
    expect(await workers.identityOf("w1")).toEqual(id);
  });
});

describe("answerAnnouncement", () => {
  const post = (body: string) => new Request("https://p.test/_g/worker", { method: "POST", body });
  const valid = JSON.stringify({ v: PROTOCOL_VERSION, n: nonce });

  it("binds the nonce to the caller's identity", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    await workers.ready();
    const response = await answerAnnouncement(post(valid), "page", async () => id, workers);
    expect(response.status).toBe(204);
    expect(await workers.claim("w1", nonce)).toEqual(id);
  });

  it("answers 400 to a body that is not an announcement", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    for (const body of ["{", "null", JSON.stringify({ v: PROTOCOL_VERSION, n: "short" })])
      expect((await answerAnnouncement(post(body), "page", async () => id, workers)).status, body).toBe(400);
  });

  it("answers 403 to a caller with no identity, and binds nothing", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 10 });
    await workers.ready();
    expect((await answerAnnouncement(post(valid), "page", async () => null, workers)).status).toBe(403);
    expect(await workers.claim("w1", nonce)).toBeNull();
  });

  it("hands a shared start over with the nonce it registered and the caller's identity", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    await workers.ready();
    const shared: unknown[] = [];
    const onShared = (...args: unknown[]) => void shared.push(args);
    const body = JSON.stringify({ v: PROTOCOL_VERSION, n: nonce, w: SHARED });
    expect((await answerAnnouncement(post(body), "page", async () => id, workers, onShared)).status).toBe(204);
    expect(shared).toEqual([[SHARED, nonce, id]]);
    expect(await workers.claim("w1", nonce)).toEqual(id);
  });

  it("hands nothing over for a plain announcement or a caller with no identity", async () => {
    const workers = new WorkerRegistry(memoryRecords());
    const shared: unknown[] = [];
    const onShared = (...args: unknown[]) => void shared.push(args);
    await answerAnnouncement(post(valid), "page", async () => id, workers, onShared);
    const body = JSON.stringify({ v: PROTOCOL_VERSION, n: "m".repeat(32), w: SHARED });
    expect((await answerAnnouncement(post(body), "page", async () => null, workers, onShared)).status).toBe(403);
    expect(shared).toEqual([]);
  });
});

const SHARED = "/_g/rpc/shared-worker?s=x&p=y&t=classic";

describe("readAnnouncement", () => {
  it("reads only the current protocol version", () => {
    expect(readAnnouncement({ v: PROTOCOL_VERSION, n: nonce })).toEqual({ nonce, shared: null });
    for (const body of [{ v: PROTOCOL_VERSION - 1, n: nonce }, { n: nonce }, null, "x"])
      expect(readAnnouncement(body), JSON.stringify(body)).toBeNull();
  });

  it("reads a shared start from an announcement and refuses a foreign one", () => {
    const prefix = "/_g/rpc/shared-worker?";
    const longest = prefix + "a".repeat(4096 - prefix.length);
    expect(readAnnouncement({ v: PROTOCOL_VERSION, n: nonce, w: SHARED })).toEqual({ nonce, shared: SHARED });
    expect(readAnnouncement({ v: PROTOCOL_VERSION, n: nonce, w: longest })?.shared).toBe(longest);
    for (const w of ["/_g/admin/x", 1, null, `${longest}a`, "/_g/rpc/shared-worker", "/_g/rpc/shared-workers?s=x"])
      expect(readAnnouncement({ v: PROTOCOL_VERSION, n: nonce, w }), String(w)).toBeNull();
  });

  it("keys a shared start by the address as the browser requests it", () => {
    const body = { v: PROTOCOL_VERSION, n: nonce, w: "/_g/rpc/shared-worker?s=it's&p=y&t=classic" };
    expect(readAnnouncement(body)?.shared).toBe("/_g/rpc/shared-worker?s=it%27s&p=y&t=classic");
  });
});

describe("readNonce", () => {
  it("reads only well-formed nonces", () => {
    expect(readNonce(new URL(`https://p.test/_g/worker.X.js?n=${nonce}`))).toBe(nonce);
    for (const bad of ["?n=short", "?n=" + "a".repeat(80), "?n=a%20b".padEnd(30, "c"), ""])
      expect(readNonce(new URL(`https://p.test/_g/worker.X.js${bad}`))).toBeNull();
  });
});
