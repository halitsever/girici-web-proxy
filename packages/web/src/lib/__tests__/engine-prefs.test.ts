import { PROTOCOL_VERSION } from "@girici/engine/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncEnginePrefs } from "../engine-prefs";

function fakeContainer(options: { answer?: boolean; registered?: boolean }) {
  const received: unknown[] = [];
  const worker = {
    postMessage(data: unknown, ports: MessagePort[]) {
      received.push(data);
      if (options.answer) ports[0]?.postMessage({ ok: true });
    },
  };
  const container = {
    getRegistration: async () => (options.registered === false ? undefined : { active: worker }),
  } as unknown as ServiceWorkerContainer;
  return { container, received };
}

afterEach(() => vi.useRealTimers());

describe("syncEnginePrefs", () => {
  it("sends the switch to the active worker and waits for its answer", async () => {
    const { container, received } = fakeContainer({ answer: true });
    await syncEnginePrefs({ blockCookies: false, sealAddresses: true }, container);
    expect(received).toEqual([
      { type: "girici:prefs", v: PROTOCOL_VERSION, blockThirdPartyCookies: false, sealAddresses: true },
    ]);
  });

  it("passes the instance switch on when it is known", async () => {
    const { container, received } = fakeContainer({ answer: true });
    await syncEnginePrefs({ blockCookies: true, sealAddresses: false }, container, true);
    expect(received).toEqual([
      {
        type: "girici:prefs",
        v: PROTOCOL_VERSION,
        blockThirdPartyCookies: true,
        sealAddresses: false,
        instanceSeal: true,
      },
    ]);
  });

  it("tells the worker this browser has seen Girici from its home, settings and account pages only", async () => {
    for (const page of ["/", "/settings", "/account"]) {
      const { container, received } = fakeContainer({ answer: true });
      await syncEnginePrefs({ blockCookies: true, sealAddresses: false }, container, undefined, page);
      expect(received, page).toEqual([
        { type: "girici:prefs", v: PROTOCOL_VERSION, blockThirdPartyCookies: true, sealAddresses: false, seen: true },
      ]);
    }
    for (const page of ["/_g/challenge", "/_g/login", "/_g/setup"]) {
      const { container, received } = fakeContainer({ answer: true });
      await syncEnginePrefs({ blockCookies: true, sealAddresses: false }, container, undefined, page);
      expect(received[0], page).not.toHaveProperty("seen");
    }
  });

  it("gives up after a second when the worker never answers", async () => {
    vi.useFakeTimers();
    const { container } = fakeContainer({ answer: false });
    const done = syncEnginePrefs({ blockCookies: true, sealAddresses: false }, container);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
  });

  it("does nothing without a registration or service worker support", async () => {
    await expect(
      syncEnginePrefs({ blockCookies: true, sealAddresses: false }, fakeContainer({ registered: false }).container),
    ).resolves.toBeUndefined();
    await expect(syncEnginePrefs({ blockCookies: true, sealAddresses: false }, undefined)).resolves.toBeUndefined();
  });
});
