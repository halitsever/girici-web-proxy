import { PROTOCOL_VERSION } from "@girici/engine/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "../auth";
import type { Settings } from "../settings";
import { isSiteMode, retireRootEngine, siteUrlPattern, syncSettings, type RetireEnv } from "../sites";

const SETTINGS: Settings = {
  engine: "Bing",
  newTab: true,
  rememberHistory: false,
  blockCookies: false,
  toolbar: false,
  sealAddresses: true,
};

function authState(siteDomain: string | null): AuthState {
  return { setup: false, authed: false, public: true, sealAddresses: false, deepLinkWarning: false, siteDomain };
}

function recordFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("isSiteMode", () => {
  it("is on only when the server names a site domain", () => {
    expect(isSiteMode(authState("proxy.test"))).toBe(true);
    expect(isSiteMode(authState("girici.localhost:41005"))).toBe(true);
    expect(isSiteMode(authState(null))).toBe(false);
    expect(isSiteMode({ siteDomain: undefined as unknown as null })).toBe(false);
    expect(isSiteMode(null)).toBe(false);
  });
});

describe("syncSettings", () => {
  it("posts the engine settings to the root in subdomain mode", async () => {
    const calls = recordFetch();
    await syncSettings(SETTINGS, authState("proxy.test"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/_g/prefs");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(new Headers(calls[0]!.init?.headers).get("content-type")).toBe("application/json");
    expect(calls[0]!.init?.body).toBe(
      '{"blockThirdPartyCookies":false,"sealAddresses":true,"toolbar":false,"engine":"Bing"}',
    );
  });

  it("does not fail when the root cannot take the settings", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    await expect(syncSettings(SETTINGS, authState("proxy.test"))).resolves.toBeUndefined();
  });

  it("keeps single-origin syncing as it was", async () => {
    const calls = recordFetch();
    const received: unknown[] = [];
    const worker = {
      postMessage(data: unknown, ports: MessagePort[]) {
        received.push(data);
        ports[0]?.postMessage({ ok: true });
      },
    };
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration: async () => ({ active: worker }) } });
    await syncSettings(SETTINGS, authState(null));
    expect(calls).toEqual([]);
    expect(received).toEqual([
      { type: "girici:prefs", v: PROTOCOL_VERSION, blockThirdPartyCookies: false, sealAddresses: true },
    ]);
  });
});

describe("retireRootEngine", () => {
  function setup(controlled: boolean) {
    const values = new Map<string, string>();
    const steps: string[] = [];
    const container = {
      controller: controlled ? {} : null,
      getRegistration: async (scope: string) => ({
        unregister: async () => {
          steps.push(`unregister ${scope}`);
          return true;
        },
      }),
    };
    const env: RetireEnv = {
      container: () => container as unknown as ServiceWorkerContainer,
      storage: () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
      }),
      reload: () => void steps.push("reload"),
    };
    return { env, container, values, steps };
  }

  it("unregisters a root service worker left from single-origin mode and reloads once", async () => {
    const { env, container, values, steps } = setup(true);
    expect(await retireRootEngine(env)).toBe(true);
    expect(steps).toEqual(["unregister /", "reload"]);
    expect(values.get("girici:retire-reload")).toBe("1");

    expect(await retireRootEngine(env)).toBe(false);
    expect(steps.filter((step) => step === "reload")).toHaveLength(1);

    container.controller = null;
    expect(await retireRootEngine(env)).toBe(false);
    expect(values.has("girici:retire-reload")).toBe(false);
  });

  it("leaves an uncontrolled tab and a browser without service workers alone", async () => {
    const { env, steps } = setup(false);
    expect(await retireRootEngine(env)).toBe(false);
    expect(steps).toEqual(["unregister /"]);
    expect(await retireRootEngine({ ...env, container: () => undefined })).toBe(false);
  });

  it("never throws, and does not reload when something fails", async () => {
    const { env, container, steps } = setup(true);
    container.getRegistration = () => Promise.reject(new Error("insecure"));
    expect(await retireRootEngine(env)).toBe(false);
    expect(steps).toEqual([]);
    const blocked = setup(true);
    const failing = () => {
      throw new Error("blocked");
    };
    expect(await retireRootEngine({ ...blocked.env, storage: failing })).toBe(false);
    expect(blocked.steps).not.toContain("reload");
  });
});

describe("siteUrlPattern", () => {
  it("matches proxy addresses on this instance's site hosts only", () => {
    const pattern = siteUrlPattern("proxy.test");
    expect(pattern.test("https://k6wjalxihe6pja6woodbryo47k.proxy.test/~/x/abc.def")).toBe(true);
    expect(pattern.test("http://k6wjalxihe6pja6woodbryo47k.proxy.test/~/https/a.test/")).toBe(true);
    for (const other of [
      "https://k6wjalxihe6pja6woodbryo47k.proxyxtest/~/x/abc.def",
      "https://k6wjalxihe6pja6woodbryo47k.proxy.test.evil/~/x/abc.def",
      "https://k6wjalxihe6pja6woodbryo47k.proxy.test@evil.test/~/x/abc.def",
      "https://k6wjalxihe6pja6woodbryo47k.proxy.test/settings",
      "https://proxy.test/~/https/a.test/",
      "https://www.proxy.test/~/https/a.test/",
    ]) {
      expect(pattern.test(other), other).toBe(false);
    }
    const local = siteUrlPattern("girici.localhost:41005");
    expect(local.test("http://cmkprjpf6pvd57ha4qtfwpo3wp.girici.localhost:41005/~/https/site-a.test/")).toBe(true);
    expect(local.test("http://cmkprjpf6pvd57ha4qtfwpo3wp.girici.localhost/~/https/site-a.test/")).toBe(false);
    expect(siteUrlPattern("not a domain").test("https://k6wjalxihe6pja6woodbryo47k.proxy.test/~/x")).toBe(false);
  });
});
