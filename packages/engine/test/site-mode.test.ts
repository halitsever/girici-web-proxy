import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SITE_PREFS, type SiteConfigAnswer } from "../src/shared/protocol.ts";
import { toBase64Url } from "../src/shared/seal-cipher.ts";
import {
  FIRST_KEY_WAIT_MS,
  PAGE_CONFIG_WAIT_MS,
  SiteModeService,
  type SiteState,
  type SiteStore,
} from "../src/sw/site-mode.ts";

const HOST = "k6wjalxihe6pja6woodbryo47k.proxy.test";

const answer: SiteConfigAnswer = {
  v: 1,
  domain: "proxy.test",
  label: "k6wjalxihe6pja6woodbryo47k",
  key: toBase64Url(new Uint8Array(32).fill(7)),
  prefs: DEFAULT_SITE_PREFS,
  instanceSeal: false,
};

function memoryStore(initial?: unknown): SiteStore & { value: unknown } {
  const store = {
    value: initial,
    load: async () => store.value,
    save: async (value: unknown) => {
      store.value = value;
    },
  };
  return store;
}

interface Made {
  respond: (init?: RequestInit) => Response | Promise<Response>;
  store?: SiteStore;
  host?: string;
  applied?: SiteState[];
}

const calls: Array<RequestInit | undefined> = [];

function make({ respond, store = memoryStore(), host = HOST, applied }: Made): SiteModeService {
  return new SiteModeService({
    fetch: async (init) => {
      calls.push(init);
      return respond(init);
    },
    store,
    protocol: "https:",
    host,
    apply: applied ? (state) => void applied.push(state) : undefined,
  });
}

afterEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

describe("SiteModeService", () => {
  it("stays in single-origin mode when the server has no site config", async () => {
    const store = memoryStore();
    const service = make({ respond: () => new Response(null, { status: 404 }), store });
    await service.ready();
    expect(service.state()).toBeNull();
    expect(service.settled()).toBe("single");
    expect(store.value).toBe("single");
    expect(calls[0]?.cache).toBe("no-store");
  });

  it("knows single-origin mode at once on a host that is no site host", async () => {
    const service = make({ respond: () => Response.json(answer), host: "proxy.test" });
    expect(service.settled()).toBe("single");
    await service.ready();
    await service.refresh(true);
    expect(service.state()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("places every site on its own host", async () => {
    const service = make({ respond: () => Response.json(answer) });
    await service.ready();
    expect(service.settled()).toBe("site");
    expect(service.hostOf(new URL("https://www.site-a.test/x"))).toBe("https://k6wjalxihe6pja6woodbryo47k.proxy.test");
    expect(service.hostOf(new URL("https://site-b.test/"))).toBe("https://g4fjzasx42nioynauh4u6ncvdg.proxy.test");
    expect(service.context(new URL("https://www.site-a.test/x"))).toEqual({
      domain: "proxy.test",
      root: "https://proxy.test",
      label: "k6wjalxihe6pja6woodbryo47k",
      key: answer.key,
      site: "https://site-a.test",
      toolbar: true,
      engine: "DuckDuckGo",
    });
  });

  it("hands each fresh config to the engine's settings", async () => {
    const applied: SiteState[] = [];
    const prefs = { ...DEFAULT_SITE_PREFS, blockThirdPartyCookies: false, sealAddresses: true };
    const service = make({ respond: () => Response.json({ ...answer, prefs, instanceSeal: true }), applied });
    await service.ready();
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ prefs, instanceSeal: true, root: "https://proxy.test" });
  });

  it("keeps the stored config when a refresh fails, and fails an install that has none", async () => {
    const store = memoryStore(answer);
    const kept = make({ respond: () => new Response(null, { status: 500 }), store });
    await kept.ready();
    expect(calls).toHaveLength(0);
    await kept.refresh(true);
    expect(kept.state()?.label).toBe(answer.label);

    const restarted = make({
      respond: () => {
        throw new TypeError("offline");
      },
      store,
    });
    await restarted.refresh(true);
    expect(restarted.state()?.label).toBe(answer.label);

    const fresh = make({
      respond: () => {
        throw new TypeError("offline");
      },
    });
    await expect(fresh.refresh(true)).rejects.toThrow();
    await expect(fresh.ready()).rejects.toThrow();
    expect(fresh.settled()).toBeNull();
  });

  it("refuses a config that names another host", async () => {
    const service = make({ respond: () => Response.json({ ...answer, label: "g4fjzasx42nioynauh4u6ncvdg" }) });
    await expect(service.refresh(true)).rejects.toThrow();
    expect(service.state()).toBeNull();
  });

  it("has no host for anything until it has a key", async () => {
    vi.useFakeTimers();
    let next: () => Response | Promise<Response> = () => Response.json({ ...answer, key: null });
    const service = make({ respond: () => next() });
    await service.ready();
    expect(service.hostOf(new URL("https://site-b.test/"))).toBeNull();
    expect(service.context(new URL("https://site-b.test/"))).toBeNull();

    let release!: (response: Response) => void;
    next = () => new Promise<Response>((resolve) => (release = resolve));
    let has: boolean | undefined;
    void service.ensureKey().then((value) => (has = value));
    await vi.advanceTimersByTimeAsync(FIRST_KEY_WAIT_MS - 1);
    expect(has).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(has).toBe(false);
    expect(calls).toHaveLength(2);

    release(Response.json(answer));
    await vi.advanceTimersByTimeAsync(0);
    expect(await service.ensureKey()).toBe(true);
    expect(service.hostOf(new URL("https://site-b.test/"))).toBe("https://g4fjzasx42nioynauh4u6ncvdg.proxy.test");
  });

  it("lets a page wait at most 500 ms for its config", async () => {
    vi.useFakeTimers();
    let next: () => Response | Promise<Response> = () => Response.json(answer);
    const service = make({ respond: () => next() });
    await service.ready();
    next = () => new Promise<Response>(() => {});
    let done = false;
    void service.forPage().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(PAGE_CONFIG_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("lets a page go on as soon as its config arrives", async () => {
    const prefs = { ...DEFAULT_SITE_PREFS, toolbar: false };
    let next = answer;
    const service = make({ respond: () => Response.json(next) });
    await service.ready();
    next = { ...answer, prefs };
    await service.forPage();
    expect(service.state()?.prefs.toolbar).toBe(false);
  });

  it("reports each site once", async () => {
    const service = make({ respond: () => Response.json(answer) });
    await service.ready();
    calls.length = 0;
    service.learnSite("https://site-a.test");
    service.learnSite("https://site-a.test");
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", body: '{"site":"https://site-a.test"}' });
    expect(new Headers(calls[0]?.headers).get("content-type")).toBe("application/json");
  });
});
