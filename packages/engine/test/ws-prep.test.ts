import { describe, expect, it } from "vitest";
import { buildWsPrep } from "../src/sw/ws-prep.ts";

const jar = {
  header: async (target: URL) => (target.host === "gateway.discord.gg" ? "sess=1" : null),
};

describe("buildWsPrep", () => {
  it("returns the jar cookie for the ws target as https, with the page origin", async () => {
    const prep = await buildWsPrep(jar, "wss://gateway.discord.gg/?v=10", new URL("https://discord.com/channels/@me"));
    expect(prep).toEqual({ cookie: "sess=1", origin: "https://discord.com" });
  });

  it("falls back to the target origin when the page url is unknown", async () => {
    const prep = await buildWsPrep(jar, "wss://gateway.discord.gg/", null);
    expect(prep?.origin).toBe("https://gateway.discord.gg");
  });

  it("rejects non-ws schemes and junk", async () => {
    expect(await buildWsPrep(jar, "https://gateway.discord.gg/", null)).toBeNull();
    expect(await buildWsPrep(jar, "not a url", null)).toBeNull();
  });
});
