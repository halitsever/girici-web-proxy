import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedWorkerPath } from "../src/shared/worker-boot.ts";
import {
  announceSharedStart,
  answerSharedWorker,
  readSharedStart,
  SHARED_START_TTL_MS,
  SHARED_START_WAIT_MS,
  SharedWorkerStarts,
  startFits,
} from "../src/sw/shared-workers.ts";
import type { WorkerIdentity } from "../src/sw/worker-identity.ts";

const origin = "http://proxy.test";
const identity: WorkerIdentity = { page: "https://site-a.test/app", top: "https://site-a.test" };
const SITE_A = "__g|https://site-a.test|";
const SCRIPT = `${origin}/~/https/site-a.test/shared.js`;
const nonce = "n".repeat(32);

const addressOf = (partition = SITE_A, module = false, script = SCRIPT) =>
  new URL(origin + sharedWorkerPath(script, partition, module));
const keyOf = (url: URL) => url.pathname + url.search;
const answer = (url: URL, starts: SharedWorkerStarts, destination = "sharedworker") =>
  answerSharedWorker({ destination }, url, { origin, runtimePath: "/_g/worker.x.js", starts });

/** Answers a start that `who` announced, giving up after the wait in fake time. */
async function answerFor(who: WorkerIdentity, partition: string): Promise<Response> {
  const starts = new SharedWorkerStarts();
  const url = addressOf(partition);
  starts.announce(keyOf(url), nonce, who);
  const pending = answer(url, starts);
  await vi.advanceTimersByTimeAsync(SHARED_START_WAIT_MS);
  return pending;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("answerSharedWorker", () => {
  it("hands a shared worker the bootstrap its page announced", async () => {
    const starts = new SharedWorkerStarts();
    const url = new URL(origin + sharedWorkerPath(SCRIPT, SITE_A, false));
    starts.announce(url.pathname + url.search, nonce, identity);
    const res = await answer(url, starts);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const code = await res.text();
    expect(code).toContain(`importScripts("${origin}/_g/worker.x.js?n=${nonce}","${SCRIPT}")`);
    expect(code).toContain('self.__giriciBase="https://site-a.test/shared.js"');
    expect(code).toContain('self.__giriciPartition="__g|https://site-a.test|"');
  });

  it("waits for an announcement that arrives after the script request", async () => {
    vi.useFakeTimers();
    const starts = new SharedWorkerStarts();
    const url = addressOf();
    const pending = answer(url, starts);
    setTimeout(() => starts.announce(keyOf(url), nonce, identity), 100);
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe(200);
  });

  it("refuses a start nobody announced", async () => {
    vi.useFakeTimers();
    const pending = answer(addressOf(), new SharedWorkerStarts());
    await vi.advanceTimersByTimeAsync(SHARED_START_WAIT_MS);
    const res = await pending;
    expect(res.status).toBe(403);
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(await res.text()).toBe("");
  });

  it("refuses a partition of another site", async () => {
    vi.useFakeTimers();
    const other = { page: "https://site-b.test/", top: "https://site-b.test" };
    expect((await answerFor(other, SITE_A)).status).toBe(403);
    expect((await answerFor(identity, "__g|https://www.site-a.test|")).status).toBe(403);
  });

  it("refuses a third-party partition whose top is not the page's", async () => {
    vi.useFakeTimers();
    const framed = "__g^|https://evil.test|https://site-a.test|";
    expect((await answerFor({ ...identity, top: "https://news.test" }, framed)).status).toBe(403);
    expect((await answerFor({ ...identity, top: null }, framed)).status).toBe(403);
    expect((await answerFor({ ...identity, top: "https://evil.test" }, framed)).status).toBe(200);
    expect((await answerFor({ ...identity, top: "https://news.test" }, "__g^|null|https://site-a.test|")).status).toBe(
      200,
    );
  });

  it("refuses a first-party partition to a page framed by another site", async () => {
    vi.useFakeTimers();
    expect((await answerFor({ ...identity, top: "https://news.test" }, SITE_A)).status).toBe(403);
    expect((await answerFor({ page: "https://www.site-a.test/", top: "https://site-a.test" }, SITE_A)).status).toBe(
      403,
    );
    const www = "__g|https://www.site-a.test|";
    expect((await answerFor({ page: "https://www.site-a.test/", top: "https://site-a.test" }, www)).status).toBe(200);
  });

  it("answers only a shared worker's script request, and leaves its announcement for it", async () => {
    const starts = new SharedWorkerStarts();
    const url = addressOf();
    starts.announce(keyOf(url), nonce, identity);
    for (const destination of ["script", "worker", "document", ""]) {
      const res = await answer(url, starts, destination);
      expect(res.status, destination).toBe(404);
      expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    }
    expect((await answer(url, starts)).status).toBe(200);
  });

  it("takes each announcement once and serves a module start with imports", async () => {
    vi.useFakeTimers();
    const starts = new SharedWorkerStarts();
    const url = addressOf(SITE_A, true);
    starts.announce(keyOf(url), nonce, identity);
    const first = await answer(url, starts);
    expect(await first.text()).toContain(
      `await import("${origin}/_g/worker.x.js?n=${nonce}");await import("${SCRIPT}");`,
    );
    const again = answer(url, starts);
    await vi.advanceTimersByTimeAsync(SHARED_START_WAIT_MS);
    expect((await again).status).toBe(403);
  });

  it("refuses an address that is not exactly the one the page hook builds", async () => {
    const starts = new SharedWorkerStarts();
    const canonical = addressOf();
    const variants = [
      `${canonical.href}&x=1`,
      `${canonical.href}&p=${encodeURIComponent("__g|https://site-b.test|")}`,
      canonical.href.replace("t=classic", "t=Classic"),
      `${origin}/_g/rpc/shared-worker?p=${encodeURIComponent(SITE_A)}&s=${encodeURIComponent(SCRIPT)}&t=classic`,
    ];
    for (const variant of variants) {
      const url = new URL(variant);
      starts.announce(keyOf(url), nonce, identity);
      expect((await answer(url, starts)).status, variant).toBe(403);
    }
  });
});

describe("readSharedStart", () => {
  it("reads the script, its real base, the partition and the type", () => {
    expect(readSharedStart(addressOf(SITE_A, true), origin)).toEqual({
      scriptUrl: SCRIPT,
      base: new URL("https://site-a.test/shared.js"),
      partition: SITE_A,
      module: true,
    });
  });

  it("refuses a script off the proxy, a partition it cannot read and an unknown type", () => {
    const refused = [
      addressOf(SITE_A, false, "https://site-a.test/shared.js"),
      addressOf(SITE_A, false, "http://other.test/~/https/site-a.test/shared.js"),
      addressOf(SITE_A, false, `${origin}/_g/admin/x`),
      addressOf(SITE_A, false, `${origin}/~/ftp/site-a.test/x`),
      addressOf(SITE_A, false, "data:text/javascript,1"),
      addressOf("girici:settings"),
      addressOf("__g|javascript:1|"),
      new URL(addressOf().href.replace("t=classic", "t=json")),
      new URL(`${origin}/_g/rpc/shared-worker?s=${encodeURIComponent(SCRIPT)}&p=${encodeURIComponent(SITE_A)}`),
      new URL(addressOf().href.replace("/_g/rpc/shared-worker", "/_g/rpc/worker")),
    ];
    for (const url of refused) expect(readSharedStart(url, origin), url.href).toBeNull();
    expect(readSharedStart(new URL(addressOf().href.replace(origin, "http://other.test")), origin)).toBeNull();
  });

  it("reads an address whose script carries characters the browser escapes in a query", () => {
    const script = `${origin}/~/https/site-a.test/it's.js`;
    const url = new URL(origin + sharedWorkerPath(script, SITE_A, false));
    expect(url.search).toContain("%27");
    expect(readSharedStart(url, origin)?.scriptUrl).toBe(script);
  });
});

describe("startFits", () => {
  const start = (partition: string) => readSharedStart(addressOf(partition), origin)!;

  it("fits a first-party start to its own site's top-level page or one whose top is unknown", () => {
    expect(startFits(start(SITE_A), identity)).toBe(true);
    expect(startFits(start(SITE_A), { ...identity, top: null })).toBe(true);
    expect(startFits(start(SITE_A), { page: "not a url", top: null })).toBe(false);
  });
});

describe("announceSharedStart", () => {
  it("queues only starts the announcing page may make", async () => {
    const starts = new SharedWorkerStarts();
    const key = keyOf(addressOf());
    const other = { page: "https://site-b.test/", top: "https://site-b.test" };
    expect(announceSharedStart(key, "m".repeat(32), other, { origin, starts })).toBe(false);
    expect(announceSharedStart("/_g/rpc/shared-worker?s=x&p=y&t=classic", nonce, identity, { origin, starts })).toBe(
      false,
    );
    expect(announceSharedStart(key, nonce, identity, { origin, starts })).toBe(true);
    expect(await starts.take(key, 0)).toEqual({ nonce, identity });
    expect(await starts.take(key, 0)).toBeNull();
  });
});

describe("SharedWorkerStarts", () => {
  const n = (index: number) => String(index).padStart(32, "0");

  it("hands out the newest announcement first and forgets them after their time", async () => {
    let now = 0;
    const starts = new SharedWorkerStarts({ ttlMs: 50, now: () => now });
    starts.announce("/a", n(1), identity);
    starts.announce("/a", n(2), identity);
    expect((await starts.take("/a", 0))?.nonce).toBe(n(2));
    now = 51;
    expect(await starts.take("/a", 0)).toBeNull();
  });

  it("gives a page that joined a running worker's leftover to no start a few seconds later", async () => {
    let now = 0;
    const starts = new SharedWorkerStarts({ now: () => now });
    // A page that joins an instance announces too, but its browser fetches no script for it.
    starts.announce("/a", n(1), identity);
    now = SHARED_START_TTL_MS + 1;
    expect(await starts.take("/a", 0)).toBeNull();
    starts.announce("/a", n(2), identity);
    expect((await starts.take("/a", 0))?.nonce).toBe(n(2));
    expect(SHARED_START_TTL_MS).toBeLessThanOrEqual(5000);
  });

  it("keeps the newest few per address", async () => {
    const starts = new SharedWorkerStarts({ perPath: 2 });
    for (let index = 1; index <= 3; index++) starts.announce("/a", n(index), identity);
    expect((await starts.take("/a", 0))?.nonce).toBe(n(3));
    expect((await starts.take("/a", 0))?.nonce).toBe(n(2));
    expect(await starts.take("/a", 0)).toBeNull();
  });

  it("keeps a flood from one site from pushing out another site's announcements", async () => {
    const starts = new SharedWorkerStarts({ limit: 4 });
    const flood = { page: "https://site-b.test/", top: "https://site-b.test" };
    starts.announce("/a", n(0), identity);
    for (let index = 1; index <= 8; index++) starts.announce(`/b${index}`, n(index), flood);
    expect((await starts.take("/a", 0))?.nonce).toBe(n(0));
    expect(await starts.take("/b1", 0)).toBeNull();
    expect((await starts.take("/b8", 0))?.nonce).toBe(n(8));
  });

  it("hands one announcement to each waiting request, in order", async () => {
    vi.useFakeTimers();
    const starts = new SharedWorkerStarts();
    const first = starts.take("/a", 1000);
    const second = starts.take("/a", 1000);
    starts.announce("/a", n(1), identity);
    starts.announce("/a", n(2), identity);
    expect((await first)?.nonce).toBe(n(1));
    expect((await second)?.nonce).toBe(n(2));
    const late = starts.take("/a", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await late).toBeNull();
    starts.announce("/a", n(3), identity);
    expect((await starts.take("/a", 0))?.nonce).toBe(n(3));
  });
});
