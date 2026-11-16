import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_PREFS, type EnginePrefs } from "../src/shared/protocol.ts";
import { InstanceState, readInstanceState } from "../src/sw/instance-state.ts";

function fakePrefs() {
  let current: EnginePrefs = { ...DEFAULT_ENGINE_PREFS };
  return {
    current: () => ({ ...current }),
    async set(update: Partial<EnginePrefs>) {
      current = { ...current, ...update };
    },
  };
}

const offline = async (): Promise<Response> => {
  throw new Error("offline");
};

describe("readInstanceState", () => {
  it("reads both instance switches from the sign-in state", async () => {
    expect(await readInstanceState(async () => Response.json({ sealAddresses: true }))).toEqual({
      sealAddresses: true,
      deepLinkWarning: false,
    });
    expect(await readInstanceState(async () => Response.json({ sealAddresses: false }))).toEqual({
      sealAddresses: false,
      deepLinkWarning: false,
    });
    expect(await readInstanceState(async () => Response.json({}))).toEqual({
      sealAddresses: false,
      deepLinkWarning: false,
    });
    expect(await readInstanceState(async () => Response.json({ deepLinkWarning: true }))).toEqual({
      sealAddresses: false,
      deepLinkWarning: true,
    });
    expect(await readInstanceState(async () => new Response("{}", { status: 500 }))).toBeNull();
    expect(await readInstanceState(async () => new Response("x"))).toBeNull();
    expect(await readInstanceState(async () => Response.json("x"))).toBeNull();
    expect(await readInstanceState(offline)).toBeNull();
  });
});

describe("InstanceState", () => {
  it("waits for the first answer, then reuses it for a minute", async () => {
    let now = 0;
    let calls = 0;
    const prefs = fakePrefs();
    const state = new InstanceState(
      async () => {
        calls++;
        return Response.json({ sealAddresses: true, deepLinkWarning: false });
      },
      prefs,
      () => now,
    );
    expect(await state.deepLinkWarning()).toBe(false);
    now += 30_000;
    expect(await state.deepLinkWarning()).toBe(false);
    expect(calls).toBe(1);
    now += 31_000;
    await state.deepLinkWarning();
    expect(calls).toBe(2);
    expect(prefs.current().instanceSeal).toBe(true);
  });

  it("shows the warning when the server cannot say and nothing was heard before", async () => {
    let now = 0;
    let answer: () => Promise<Response> = offline;
    const state = new InstanceState(
      () => answer(),
      fakePrefs(),
      () => now,
    );
    expect(await state.deepLinkWarning()).toBe(true);
    answer = async () => Response.json({ deepLinkWarning: false });
    expect(await state.deepLinkWarning()).toBe(false);
    now += 61_000;
    answer = offline;
    expect(await state.deepLinkWarning()).toBe(false);
  });

  it("stops waiting after the timeout", async () => {
    const state = new InstanceState(() => new Promise<Response>(() => {}), fakePrefs());
    expect(await state.deepLinkWarning(20)).toBe(true);
  });

  it("shares one request among loads that ask at once", async () => {
    let calls = 0;
    let release: (response: Response) => void = () => {};
    const state = new InstanceState(() => {
      calls++;
      return new Promise<Response>((resolve) => (release = resolve));
    }, fakePrefs());
    const first = state.deepLinkWarning();
    const second = state.deepLinkWarning();
    await expect.poll(() => calls).toBe(1);
    release(Response.json({ deepLinkWarning: true }));
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(calls).toBe(1);
  });

  it("refreshes the sealing switch at most once a minute unless forced", async () => {
    let now = 0;
    let calls = 0;
    let sealAddresses = true;
    const prefs = fakePrefs();
    const state = new InstanceState(
      async () => {
        calls++;
        return Response.json({ sealAddresses });
      },
      prefs,
      () => now,
    );
    state.refresh();
    await expect.poll(() => prefs.current().instanceSeal).toBe(true);
    sealAddresses = false;
    now += 30_000;
    state.refresh();
    expect(calls).toBe(1);
    state.refresh(true);
    await expect.poll(() => prefs.current().instanceSeal).toBe(false);
    expect(calls).toBe(2);
  });
});
