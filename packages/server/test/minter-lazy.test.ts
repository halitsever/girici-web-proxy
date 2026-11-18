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
    VirtualConsole: class {},
  };
});

describe("createPoTokenMinter", () => {
  it("loads jsdom and BotGuard only when the first token is asked for", async () => {
    const lines: string[] = [];
    const minter = createPoTokenMinter(
      // A YouTube page with a challenge, so minting gets as far as building the window.
      async () =>
        new Response(
          `<script>ytcfg.set({"EVENT_ID":"e"});</script>` +
            `<script>window.ytAtN({'R': '{"bgChallenge":{"program":"p","globalName":"g"}}'});</script>`,
        ),
      createLogger("debug", (line) => lines.push(line)),
    );
    expect(loads.jsdom).toBe(0);
    expect(await minter.mint("binding")).toBeNull();
    expect(loads.jsdom).toBe(1);
    expect(lines.join("\n")).toContain("stub window");
  });
});
