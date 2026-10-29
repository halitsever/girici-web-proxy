import { afterEach, describe, expect, it, vi } from "vitest";
import { createPoTokenMinter } from "../src/youtube/botguard-session.ts";

afterEach(() => vi.unstubAllGlobals());

describe("createPoTokenMinter", () => {
  it("sends BotGuard requests through the injected fetch", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("the global fetch skips the upstream agent");
    });
    const urls: string[] = [];
    const minter = createPoTokenMinter(async (input) => {
      urls.push(String(input));
      throw new Error("offline");
    });
    expect(await minter.mint("binding")).toBeNull();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
  });
});
