import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/log.ts";
import { createPoTokenMinter } from "../src/youtube/minter.ts";

const loads = vi.hoisted(() => ({ jsdom: 0 }));

// jsdom costs tens of megabytes, so the server must not load it before a poToken is asked for.
vi.mock("jsdom", () => {
  loads.jsdom++;
  return {
    JSDOM: class {
      constructor() {
        throw new Error("stub window");
      }
    },
  };
});

describe("createPoTokenMinter", () => {
  it("loads jsdom and BotGuard only when the first token is asked for", async () => {
    const lines: string[] = [];
    const minter = createPoTokenMinter(
      async () => new Response("{}"),
      createLogger("debug", (line) => lines.push(line)),
    );
    expect(loads.jsdom).toBe(0);
    expect(await minter.mint("binding")).toBeNull();
    expect(loads.jsdom).toBe(1);
    expect(lines.join("\n")).toContain("stub window");
  });
});
