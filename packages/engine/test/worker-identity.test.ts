import { describe, expect, it } from "vitest";
import type { ClientRecordStore } from "../src/sw/client-records.ts";
import { readNonce, WorkerRegistry } from "../src/sw/worker-identity.ts";

function memoryRecords(): ClientRecordStore {
  const stores = { ui: new Map<string, unknown>(), workers: new Map<string, unknown>() };
  return {
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
    workers.announce(nonce, id);
    expect(await workers.claim("w1", nonce)).toEqual(id);
    expect(await workers.identityOf("w1")).toEqual(id);
  });

  it("waits briefly for an announcement that arrives after the worker's first request", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 200 });
    await workers.ready();
    const claimed = workers.claim("w1", nonce);
    const pending = workers.identityOf("w1");
    setTimeout(() => workers.announce(nonce, id), 20);
    expect(await claimed).toEqual(id);
    expect(await pending).toEqual(id);
  });

  it("uses a nonce once and forgets one nobody claimed", async () => {
    const workers = new WorkerRegistry(memoryRecords(), { waitMs: 10, ttlMs: 50 });
    await workers.ready();
    workers.announce(nonce, id);
    expect(await workers.claim("w1", nonce)).toEqual(id);
    expect(await workers.claim("w2", nonce)).toBeNull();
    workers.announce("m".repeat(32), id, 0);
    expect(await workers.claim("w3", "m".repeat(32))).toBeNull(); // claimed at Date.now(), long after ttl
  });

  it("remembers a worker's site after the service worker restarts", async () => {
    const records = memoryRecords();
    const before = new WorkerRegistry(records);
    await before.ready();
    before.announce(nonce, id);
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
    workers.announce(nonce, id);
    await workers.claim("w1", nonce);
    const other = { page: "https://b.test/", top: "https://b.test" };
    workers.announce("m".repeat(32), other);
    expect(await workers.claim("w1", "m".repeat(32))).toEqual(id);
    expect(await workers.identityOf("w1")).toEqual(id);
  });
});

describe("readNonce", () => {
  it("reads only well-formed nonces", () => {
    expect(readNonce(new URL(`https://p.test/_g/worker.X.js?n=${nonce}`))).toBe(nonce);
    for (const bad of ["?n=short", "?n=" + "a".repeat(80), "?n=a%20b".padEnd(30, "c"), ""])
      expect(readNonce(new URL(`https://p.test/_g/worker.X.js${bad}`))).toBeNull();
  });
});
