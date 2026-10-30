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
  function setup(options: { controlled?: boolean; active?: boolean; registered?: boolean } = {}) {
    const values = new Map<string, string>();
    let reloads = 0;
    const container = {
      controller: options.controlled ? {} : null,
      getRegistration: async () =>
        options.registered === false ? undefined : { active: options.active === false ? null : {} },
    } as unknown as ServiceWorkerContainer;
    const env = (now: number): ReloadEnv => ({
      container,
      storage: () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
      }),
      reload: () => void reloads++,
      now,
    });
    return { env, reloads: () => reloads };
  }

  it("loads a tab the engine did not see once more, and not again at once", async () => {
    const { env, reloads } = setup();
    expect(await reloadThroughEngine(env(100_000))).toBe(true);
    expect(await reloadThroughEngine(env(101_000))).toBe(false);
    expect(reloads()).toBe(1);
    expect(await reloadThroughEngine(env(120_000))).toBe(true);
  });

  it("leaves controlled tabs and tabs without an active engine alone", async () => {
    for (const options of [{ controlled: true }, { registered: false }, { active: false }]) {
      const { env, reloads } = setup(options);
      expect(await reloadThroughEngine(env(100_000))).toBe(false);
      expect(reloads()).toBe(0);
    }
    expect(await reloadThroughEngine({ ...setup().env(100_000), container: undefined })).toBe(false);
  });

  it("does not reload when it cannot remember doing so", async () => {
    const { env, reloads } = setup();
    const blocked = {
      ...env(100_000),
      storage: () => {
        throw new Error("blocked");
      },
    };
    expect(await reloadThroughEngine(blocked)).toBe(false);
    expect(reloads()).toBe(0);
  });
});
