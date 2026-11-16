import { describe, expect, it, vi } from "vitest";
import {
  blobKey,
  type GateRealm,
  installBlobGates,
  installBlobOwners,
  OWNERS_CHANNEL,
  type OwnerRealm,
} from "../src/client/blob-owners.ts";
import { prefixFor } from "../src/shared/partition.ts";

const ORIGIN = "http://p.test";
const A = prefixFor("https://a.test");
const B = prefixFor("https://b.test");

class FakeMessageEvent {
  readonly #data: unknown;
  constructor(data: unknown) {
    this.#data = data;
  }
  get data(): unknown {
    return this.#data;
  }
}

/** One origin's channels: a message reaches every other channel of its name on a later task, as a clone. */
function channelBus() {
  const open: FakeChannel[] = [];
  const names: string[] = [];
  class FakeChannel {
    onmessage: ((event: unknown) => void) | null = null;
    readonly name: string;
    constructor(name: string) {
      this.name = name;
      names.push(name);
      open.push(this);
    }
    postMessage(message: unknown): void {
      const copy = structuredClone(message);
      for (const other of open) {
        if (other === this || other.name !== this.name) continue;
        setTimeout(() => other.onmessage?.(new FakeMessageEvent(copy)), 0);
      }
    }
  }
  return { FakeChannel, names };
}

/** Every realm makes URLs from one store, as same-origin realms do. */
function blobStore() {
  let made = 0;
  const live = new Set<string>();
  return {
    live,
    realmUrls: () => ({
      createObjectURL: () => {
        const url = `blob:${ORIGIN}/${++made}`;
        live.add(url);
        return url;
      },
      revokeObjectURL: (url: string) => void live.delete(url),
    }),
  };
}

function realms() {
  const bus = channelBus();
  const store = blobStore();
  // Long enough that a loaded test machine still delivers every answer before it.
  const realm = (partition: string, timeout = 5000) => {
    const win = {
      URL: store.realmUrls(),
      BroadcastChannel: bus.FakeChannel,
      MessageEvent: FakeMessageEvent,
      setTimeout: (run: () => void) => setTimeout(run, timeout),
    };
    const owners = installBlobOwners(win as unknown as OwnerRealm, () => partition);
    return { win, owners };
  };
  return { realm, store, bus };
}

const checked = (owners: ReturnType<typeof installBlobOwners>, url: string) =>
  new Promise<boolean>((resolve) => owners.check(url, resolve));

describe("blob owners", () => {
  it("lets a realm read its own blob URLs without asking", () => {
    const { realm, bus } = realms();
    const a = realm(A);
    const url = a.win.URL.createObjectURL();
    expect(a.owners.known(url)).toBe(true);
    expect(a.owners.known(`${url}#part`)).toBe(true);
    expect(a.owners.known("https://a.test/x")).toBe(true);
    expect(bus.names).toEqual([OWNERS_CHANNEL]);
  });

  it("refuses another partition's blob URL and allows one its own partition made elsewhere", async () => {
    const { realm } = realms();
    const a = realm(A);
    const worker = realm(A);
    const b = realm(B);
    const url = a.win.URL.createObjectURL();
    expect(b.owners.known(url)).toBeNull();
    expect(await checked(b.owners, url)).toBe(false);
    expect(await checked(worker.owners, url)).toBe(true);
  });

  it("allows a blob URL no realm claims, once the wait is over", async () => {
    const { realm } = realms();
    const b = realm(B, 20);
    expect(await checked(b.owners, `blob:${ORIGIN}/unknown`)).toBe(true);
  });

  it("keeps another partition from revoking a site's blob URL", async () => {
    const { realm, store } = realms();
    const a = realm(A);
    const b = realm(B);
    const theirs = a.win.URL.createObjectURL();
    const own = b.win.URL.createObjectURL();
    b.win.URL.revokeObjectURL(theirs);
    b.win.URL.revokeObjectURL(own);
    // Asked again after the refusal, so the first question has had its answer.
    await checked(b.owners, theirs);
    expect([...store.live]).toEqual([theirs]);
  });

  it("is not fooled by fields a page puts on Object.prototype", async () => {
    const { realm } = realms();
    const a = realm(A);
    const b = realm(B);
    const url = a.win.URL.createObjectURL();
    Object.defineProperty(Object.prototype, "kind", { configurable: true, get: () => "ask" });
    try {
      expect(await checked(b.owners, url)).toBe(false);
    } finally {
      delete (Object.prototype as { kind?: unknown }).kind;
    }
  });

  it("keeps the fragment out of the address it tracks", () => {
    expect(blobKey("BLOB:http://p.test/1#x")).toBe("blob:http://p.test/1");
    expect(blobKey("https://a.test/")).toBeNull();
  });
});

/** A realm whose fetch and XMLHttpRequest log what reaches them. */
function gatedRealm(partition: string, env: ReturnType<typeof realms>) {
  const { win, owners } = env.realm(partition);
  const log: string[] = [];
  class Request {
    readonly #url: string;
    constructor(input: string) {
      this.#url = input;
    }
    get url(): string {
      return this.#url;
    }
  }
  class XMLHttpRequest {
    open(method: string, url: string, async?: boolean) {
      log.push(`open:${method}:${url}:${async === false ? "sync" : "async"}`);
    }
    send() {
      log.push("send");
    }
    abort() {
      log.push("abort");
    }
  }
  const gate = {
    fetch: (input: unknown) => {
      log.push(`fetch:${input instanceof Request ? input.url : String(input)}`);
      return Promise.resolve("response");
    },
    Request,
    XMLHttpRequest,
    Promise,
    TypeError,
  };
  installBlobGates(gate as unknown as GateRealm, owners, ORIGIN);
  return { win, owners, gate, log, XMLHttpRequest };
}

describe("blob gates", () => {
  it("fetches its own and unclaimed blobs and fails another partition's", async () => {
    const env = realms();
    const a = gatedRealm(A, env);
    const b = gatedRealm(B, env);
    const theirs = a.win.URL.createObjectURL();
    const own = b.win.URL.createObjectURL();
    await expect(b.gate.fetch(theirs)).rejects.toBeInstanceOf(TypeError);
    await expect(b.gate.fetch(new b.gate.Request(theirs))).rejects.toBeInstanceOf(TypeError);
    expect(await b.gate.fetch(own)).toBe("response");
    expect(await b.gate.fetch("https://b.test/x")).toBe("response");
    expect(b.log).toEqual([`fetch:${own}`, "fetch:https://b.test/x"]);
  });

  it("reads the page's address once", async () => {
    const env = realms();
    const a = gatedRealm(A, env);
    const b = gatedRealm(B, env);
    const theirs = a.win.URL.createObjectURL();
    let reads = 0;
    const shifty = { toString: () => (reads++ === 0 ? "https://b.test/x" : theirs) };
    await b.gate.fetch(shifty);
    expect(b.log).toEqual(["fetch:https://b.test/x"]);
  });

  it("fails an XMLHttpRequest for another partition's blob as a missing blob", async () => {
    const env = realms();
    const a = gatedRealm(A, env);
    const b = gatedRealm(B, env);
    const theirs = a.win.URL.createObjectURL();
    const xhr = new b.XMLHttpRequest();
    xhr.open("GET", theirs);
    xhr.send();
    expect(b.log).toEqual([`open:GET:${theirs}:async`]);
    const missing = `blob:${ORIGIN}/00000000-0000-0000-0000-000000000000`;
    await vi.waitFor(() => expect(b.log).toEqual([`open:GET:${theirs}:async`, `open:GET:${missing}:async`, "send"]));
  });

  it("sends its own blob requests at once and drops a held one the page aborted", async () => {
    const env = realms();
    const a = gatedRealm(A, env);
    const b = gatedRealm(B, env);
    const own = b.win.URL.createObjectURL();
    const theirs = a.win.URL.createObjectURL();
    const sync = new b.XMLHttpRequest();
    sync.open("GET", own, false);
    sync.send();
    const held = new b.XMLHttpRequest();
    held.open("GET", theirs);
    held.send();
    held.abort();
    await checked(b.owners, theirs);
    expect(b.log).toEqual([`open:GET:${own}:sync`, "send", `open:GET:${theirs}:async`, "abort"]);
  });
});
