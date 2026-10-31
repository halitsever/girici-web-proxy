import { PROTOCOL_VERSION } from "@girici/engine/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sealPath } from "../seal";

function fakeContainer(answer?: unknown) {
  const received: unknown[] = [];
  const worker = {
    postMessage(data: unknown, ports: MessagePort[]) {
      received.push(data);
      if (answer !== undefined) ports[0]?.postMessage(answer);
    },
  };
  const container = { getRegistration: async () => ({ active: worker }) } as unknown as ServiceWorkerContainer;
  return { container, received };
}

afterEach(() => vi.useRealTimers());

describe("sealPath", () => {
  it("asks the worker to seal the address it opens", async () => {
    const { container, received } = fakeContainer({ path: "/~/x/L.B" });
    await expect(sealPath("/~/https/a.test/", container)).resolves.toBe("/~/x/L.B");
    expect(received).toEqual([{ type: "girici:seal", v: PROTOCOL_VERSION, path: "/~/https/a.test/" }]);
  });

  it("falls back to the plain address", async () => {
    vi.useFakeTimers();
    const silent = sealPath("/~/https/a.test/", fakeContainer().container);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(silent).resolves.toBe("/~/https/a.test/");
    vi.useRealTimers();
    await expect(sealPath("/~/https/a.test/", fakeContainer({ path: null }).container)).resolves.toBe(
      "/~/https/a.test/",
    );
    await expect(sealPath("/~/https/a.test/", undefined)).resolves.toBe("/~/https/a.test/");
    const none = { getRegistration: async () => undefined } as unknown as ServiceWorkerContainer;
    await expect(sealPath("/~/https/a.test/", none)).resolves.toBe("/~/https/a.test/");
  });
});
