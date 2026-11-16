import { describe, expect, it } from "vitest";
import { buildWsPrep, sealWsPrep, wsCaller } from "../src/sw/ws-prep.ts";

const jar = {
  header: async (target: URL) => (target.host === "gateway.discord.gg" ? "sess=1" : null),
};

describe("buildWsPrep", () => {
  it("returns the jar cookie for the ws target as https, with the page origin", async () => {
    const prep = await buildWsPrep(jar, "wss://gateway.discord.gg/?v=10", new URL("https://discord.com/channels/@me"));
    expect(prep).toEqual({ url: "wss://gateway.discord.gg/?v=10", cookie: "sess=1", origin: "https://discord.com" });
  });

  it("falls back to the target origin when the page url is unknown", async () => {
    const prep = await buildWsPrep(jar, "wss://gateway.discord.gg/", null);
    expect(prep?.origin).toBe("https://gateway.discord.gg");
  });

  it("rejects non-ws schemes and junk", async () => {
    expect(await buildWsPrep(jar, "https://gateway.discord.gg/", null)).toBeNull();
    expect(await buildWsPrep(jar, "not a url", null)).toBeNull();
  });

  it("sends a worker no page vouched for with no cookies and an opaque Origin, whatever the setting", async () => {
    const asked: URL[] = [];
    const spy = { header: async (target: URL) => (asked.push(target), "sess=1") };
    const caller = wsCaller("worker", null, null);
    const prep = await buildWsPrep(spy, "wss://gateway.discord.gg/", caller, () => true);
    expect(prep).toEqual({ url: "wss://gateway.discord.gg/", cookie: null, origin: "null" });
    expect(asked).toEqual([]);
    expect(wsCaller(undefined, null, null)).toBe("anonymous");
    expect(wsCaller("sharedworker", null, { page: "https://a.test/x" })).toEqual(new URL("https://a.test/x"));
    expect(wsCaller("window", new URL("https://b.test/"), null)).toEqual(new URL("https://b.test/"));
    expect(wsCaller("window", null, { page: "https://a.test/x" })).toBeNull();
  });

  it("leaves the cookie out when the target's cookies are blocked", async () => {
    const prep = await buildWsPrep(jar, "wss://gateway.discord.gg/", new URL("https://a.test/"), () => false);
    expect(prep).toEqual({ url: "wss://gateway.discord.gg/", cookie: null, origin: "https://a.test" });
  });
});

describe("sealWsPrep", () => {
  const prep = { url: "wss://gateway.discord.gg/", cookie: "sess=1", origin: "https://discord.com" };

  it("has the server seal the cookie and Origin and returns only the seal", async () => {
    let sent = "";
    const seal = await sealWsPrep(prep, async (body) => {
      sent = body;
      return new Response(JSON.stringify({ seal: "S" }));
    });
    expect(seal).toBe("S");
    expect(JSON.parse(sent)).toEqual({
      url: "wss://gateway.discord.gg/",
      origin: "https://discord.com",
      cookie: "sess=1",
    });
  });

  it("gives null when the server refuses or the request fails", async () => {
    expect(await sealWsPrep(prep, async () => new Response(null, { status: 401 }))).toBeNull();
    expect(
      await sealWsPrep(prep, async () => {
        throw new TypeError("offline");
      }),
    ).toBeNull();
  });
});

describe("the URL that gets sealed", () => {
  it("is the one the jar was read for, in canonical form, not the page's raw string", async () => {
    const prep = await buildWsPrep(jar, "WSS://Gateway.Discord.GG/?v=10", new URL("https://discord.com/"));
    expect(prep?.url).toBe("wss://gateway.discord.gg/?v=10");
  });
});
