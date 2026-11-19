import { afterEach, describe, expect, it, vi } from "vitest";
import { install, installPrompt, watchInstallPrompt } from "../install";

function offer(target: EventTarget, outcome: "accepted" | "dismissed") {
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  installPrompt.value = null;
});

describe("install prompt", () => {
  it("keeps the browser's offer and shows it once on request", async () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    expect(installPrompt.value).toBeNull();
    const event = offer(target, "accepted");
    expect(installPrompt.value).toBe(event);
    expect(await install()).toBe(true);
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(installPrompt.value).toBeNull();
    expect(await install()).toBe(false);
  });

  it("reports a dismissed offer, which the browser will not show again from the same event", async () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    offer(target, "dismissed");
    expect(await install()).toBe(false);
    expect(installPrompt.value).toBeNull();
  });

  it("drops the offer once the app is installed another way", () => {
    const target = new EventTarget();
    watchInstallPrompt(target);
    offer(target, "accepted");
    target.dispatchEvent(new Event("appinstalled"));
    expect(installPrompt.value).toBeNull();
  });
});
