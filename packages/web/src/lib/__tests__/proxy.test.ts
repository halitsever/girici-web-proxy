import { describe, expect, it } from "vitest";
import { reloadThroughEngine, serviceWorkerSupport, type ReloadEnv } from "../proxy";

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
  function setup(options: { active?: boolean; registered?: boolean } = {}) {
    const values = new Map<string, string>();
    let reloads = 0;
    const container = {
      controller: null as object | null,
      getRegistration: async () =>
        options.registered === false ? undefined : { active: options.active === false ? null : {} },
    };
    const env: ReloadEnv = {
      container: () => container as unknown as ServiceWorkerContainer,
      storage: () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
      }),
      reload: () => void reloads++,
    };
    return { env, container, reloads: () => reloads };
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
});
