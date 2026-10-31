import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/log.ts";
import { UpstreamProxyError } from "../src/upstream/tunnel.ts";
import { createPoTokenMinter } from "../src/youtube/minter.ts";

afterEach(() => vi.unstubAllGlobals());

const quiet = createLogger("error", () => {});

describe("createPoTokenMinter", () => {
  it("sends BotGuard requests through the injected fetch", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("the global fetch skips the upstream agent");
    });
    const urls: string[] = [];
    const minter = createPoTokenMinter(async (input) => {
      urls.push(String(input));
      throw new Error("offline");
    }, quiet);
    expect(await minter.mint("binding")).toBeNull();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("warns once when the upstream proxy fails and logs other failures at debug level", async () => {
    const lines: string[] = [];
    const proxyDown = createPoTokenMinter(
      async () => {
        throw new TypeError("fetch failed", { cause: new UpstreamProxyError("proxy", "refused") });
      },
      createLogger("debug", (line) => lines.push(line)),
    );
    expect(await proxyDown.mint("binding")).toBeNull();
    expect(await proxyDown.mint("binding")).toBeNull();
    expect(lines.filter((line) => line.includes("WARN") && line.includes("Upstream proxy failed"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("DEBUG") && line.includes("poToken"))).toBe(true);
    expect(lines.join("\n")).not.toContain("binding");
  });
});
