import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openProxied,
  openProxiedTab,
  reloadThroughEngine,
  serviceWorkerSupport,
  startEngine,
  type ReloadEnv,
} from "../proxy";

describe("serviceWorkerSupport", () => {
  it.each([
    [{ isSecureContext: true, hasServiceWorker: true }, "ok"],
    [{ isSecureContext: false, hasServiceWorker: false }, "insecure"],
    [{ isSecureContext: true, hasServiceWorker: false }, "unsupported"],
  ])("serviceWorkerSupport(%o) is %s", (env, expected) => {
    expect(serviceWorkerSupport(env)).toBe(expected);
  });
});

describe("reloadThroughEngine", () => {
  function setup(options: { active?: boolean; registered?: boolean; knowsTab?: boolean } = {}) {
    const values = new Map<string, string>();
    let reloads = 0;
    const listeners: Array<() => void> = [];
    const container = {
      controller: null as object | null,
      getRegistration: async () =>
        options.registered === false ? undefined : { active: options.active === false ? null : {} },
      addEventListener: (type: string, listener: () => void) => {
        if (type === "controllerchange") listeners.push(listener);
      },
    };
    const env: ReloadEnv = {
      container: () => container as unknown as ServiceWorkerContainer,
      storage: () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
      }),
      reload: () => void reloads++,
      knowsTab: async () => options.knowsTab ?? true,
    };
    const gainControl = async () => {
      container.controller = {};
      for (const listener of listeners.splice(0)) listener();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { env, container, values, gainControl, reloads: () => reloads };
  }

  it("loads a tab the engine did not see once more, and not again when that did not help", async () => {
    const { env, reloads } = setup();
    expect(await reloadThroughEngine(env)).toBe(true);
    expect(await reloadThroughEngine(env)).toBe(false);
    expect(reloads()).toBe(1);
  });

  it("reloads after a later hard reload once a controlled load has cleared the mark", async () => {
    const { env, container, reloads } = setup();
    await reloadThroughEngine(env);
    container.controller = {};
    expect(await reloadThroughEngine(env)).toBe(false);
    container.controller = null;
    expect(await reloadThroughEngine(env)).toBe(true);
    expect(reloads()).toBe(2);
  });

  it("leaves tabs without an active engine alone", async () => {
    for (const options of [{ registered: false }, { active: false }]) {
      const { env, reloads } = setup(options);
      expect(await reloadThroughEngine(env)).toBe(false);
      expect(reloads()).toBe(0);
    }
    expect(await reloadThroughEngine({ ...setup().env, container: () => undefined })).toBe(false);
  });

  it("never throws, and does not reload when something fails", async () => {
    const { env, container, reloads } = setup();
    const failing = () => {
      throw new Error("blocked");
    };
    expect(await reloadThroughEngine({ ...env, storage: failing })).toBe(false);
    expect(await reloadThroughEngine({ ...env, container: failing })).toBe(false);
    container.getRegistration = () => Promise.reject(new Error("insecure"));
    expect(await reloadThroughEngine(env)).toBe(false);
    expect(reloads()).toBe(0);
  });

  it("loads a tab once more when it gains control the engine did not see", async () => {
    const { env, gainControl, reloads } = setup({ registered: false, knowsTab: false });
    expect(await reloadThroughEngine(env)).toBe(false);
    await gainControl();
    expect(reloads()).toBe(1);
  });

  it("keeps a tab the engine knows when it gains control", async () => {
    const { env, gainControl, reloads } = setup({ registered: false, knowsTab: true });
    await reloadThroughEngine(env);
    await gainControl();
    expect(reloads()).toBe(0);
  });

  it("does not reload on gaining control when an earlier reload did not help", async () => {
    const { env, gainControl, reloads } = setup({ knowsTab: false });
    expect(await reloadThroughEngine(env)).toBe(true);
    expect(await reloadThroughEngine(env)).toBe(false);
    await gainControl();
    expect(reloads()).toBe(1);
  });

  it("does not watch a tab that loaded under the engine", async () => {
    const { env, container, gainControl, reloads } = setup({ knowsTab: false });
    container.controller = {};
    await reloadThroughEngine(env);
    await gainControl();
    expect(reloads()).toBe(0);
  });
});

describe("openProxied", () => {
  it("opens the address the engine seals", async () => {
    const steps: string[] = [];
    await openProxied("/~/https/a.test/", {
      siteMode: false,
      start: async () => void steps.push("start"),
      markSeen: async () => void steps.push("seen"),
      seal: async (path) => {
        steps.push(`seal ${path}`);
        return "/~/x/L.B";
      },
      assign: (url) => void steps.push(`assign ${url}`),
      openTab: (url) => void steps.push(`tab ${url}`),
    });
    expect(steps).toEqual(["start", "seal /~/https/a.test/", "assign /~/x/L.B"]);
  });

  it("opens a site through the root address once every site host knows this browser opened it from Girici", async () => {
    const steps: string[] = [];
    let release = () => {};
    const opening = openProxied("/~/https/site-a.test/", {
      siteMode: true,
      start: async () => void steps.push("start"),
      markSeen: () =>
        new Promise<void>((resolve) => {
          steps.push("seen");
          release = resolve;
        }),
      seal: async (path) => {
        steps.push(`seal ${path}`);
        return "/~/x/L.B";
      },
      assign: (url) => void steps.push(`assign ${url}`),
      openTab: (url) => void steps.push(`tab ${url}`),
    });
    await Promise.resolve();
    expect(steps).toEqual(["seen"]);
    release();
    await opening;
    expect(steps).toEqual(["seen", "assign /~/https/site-a.test/"]);
  });
});

describe("openProxiedTab", () => {
  const env = (siteMode: boolean, steps: string[]) => ({
    siteMode,
    start: async () => void steps.push("start"),
    markSeen: async () => void steps.push("seen"),
    seal: async () => "/~/x/L.B",
    assign: (url: string) => void steps.push(`assign ${url}`),
    openTab: (url: string) => void steps.push(`tab ${url}`),
  });

  it("starts the engine before the new tab loads the site", async () => {
    const steps: string[] = [];
    await openProxiedTab("/~/https/a.test/", env(false, steps));
    expect(steps).toEqual(["start", "tab /~/https/a.test/"]);
  });

  it("tells every site host first in subdomain mode, where the tab's own host starts its worker", async () => {
    const steps: string[] = [];
    await openProxiedTab("/~/https/a.test/", env(true, steps));
    expect(steps).toEqual(["seen", "tab /~/https/a.test/"]);
  });
});

describe("startEngine", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tells the worker this browser has seen Girici, since the visitor is opening a site from it", async () => {
    const received: unknown[] = [];
    const worker = {
      postMessage(data: unknown, ports: MessagePort[]) {
        received.push(data);
        ports[0]?.postMessage({ ok: true });
      },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: async () => ({}),
        ready: Promise.resolve({}),
        getRegistration: async () => ({ active: worker }),
      },
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await startEngine();
    expect(received).toEqual([expect.objectContaining({ type: "girici:prefs", seen: true })]);
  });
});
