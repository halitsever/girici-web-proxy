import { describe, expect, it, vi } from "vitest";
import { PoTokenMinter, type PoSession } from "../src/youtube/potoken.ts";

function session(expiresAt: number, tag: string): PoSession {
  return { expiresAt, mint: async (binding) => `pot:${tag}:${binding}` };
}

describe("PoTokenMinter", () => {
  it("reuses one session for mints within its ttl", async () => {
    let now = 0;
    const create = vi.fn(async () => session(10_000, "a"));
    const minter = new PoTokenMinter(create, () => now);

    expect(await minter.mint("v1")).toBe("pot:a:v1");
    now = 5_000;
    expect(await minter.mint("v2")).toBe("pot:a:v2");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refreshes the session after its ttl expires", async () => {
    let now = 0;
    let n = 0;
    const create = vi.fn(async () => session(now + 10_000, `s${++n}`));
    const minter = new PoTokenMinter(create, () => now);

    expect(await minter.mint("v")).toBe("pot:s1:v");
    now = 10_001;
    expect(await minter.mint("v")).toBe("pot:s2:v");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight session across concurrent mints", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const create = vi.fn(async () => {
      await gate;
      return session(10_000, "a");
    });
    const minter = new PoTokenMinter(create, () => 0);

    const both = Promise.all([minter.mint("v1"), minter.mint("v2")]);
    release();
    expect(await both).toEqual(["pot:a:v1", "pot:a:v2"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("returns null when session creation fails, and retries next time", async () => {
    const now = 0;
    const create = vi
      .fn<() => Promise<PoSession>>()
      .mockRejectedValueOnce(new Error("botguard down"))
      .mockResolvedValueOnce(session(10_000, "a"));
    const minter = new PoTokenMinter(create, () => now);

    expect(await minter.mint("v")).toBeNull();
    expect(await minter.mint("v")).toBe("pot:a:v");
    expect(create).toHaveBeenCalledTimes(2);
  });
});
