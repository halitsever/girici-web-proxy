import { describe, expect, it } from "vitest";
import { createLabelLookup, createSiteLabels } from "../src/client/site-labels.ts";
import { LABEL_RPC_PATH, type MessageEnvelope, type SiteContext } from "../src/shared/protocol.ts";
import { toBase64Url } from "../src/shared/seal-cipher.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const key = new Uint8Array(32).fill(7);
const sites: SiteContext = {
  domain: "proxy.test",
  root: "https://proxy.test",
  label: "k6wjalxihe6pja6woodbryo47k",
  key: toBase64Url(key),
  site: "https://site-a.test",
  toolbar: true,
  engine: "DuckDuckGo",
};
const A = "https://k6wjalxihe6pja6woodbryo47k.proxy.test";
const B = "https://g4fjzasx42nioynauh4u6ncvdg.proxy.test";
const env = (fields: Partial<MessageEnvelope>) => ({
  "\u0000girici": 1,
  o: "https://www.site-b.test",
  s: "https://site-b.test",
  t: "*",
  d: 5,
  ...fields,
});

describe("createSiteLabels", () => {
  it("accepts a claim only from the host its site belongs to", () => {
    const labels = createSiteLabels(
      sites,
      () => "https://www.site-a.test",
      async () => [],
    );
    expect(labels.verify(B, env({}))).toEqual({ origin: "https://www.site-b.test", target: "*", data: 5 });
    expect(labels.hostOf("https://www.site-b.test")).toBe(B);
    expect(labels.verify(B, env({ s: "https://site-c.test" }))).toBeNull();
    expect(labels.verify(B, env({ o: "https://evil.test" }))).toBeNull();
    expect(labels.verify(B, env({ o: "http://site-b.test" }))).toBeNull();
    expect(labels.verify(B, Object.create(env({})))).toBeNull();
  });

  it("refuses a claim from a host of another scheme, domain or this host itself", () => {
    const labels = createSiteLabels(
      sites,
      () => "https://site-a.test",
      async () => [],
    );
    expect(labels.verify("http://g4fjzasx42nioynauh4u6ncvdg.proxy.test", env({}))).toBeNull();
    expect(labels.verify("https://g4fjzasx42nioynauh4u6ncvdg.evil.test", env({}))).toBeNull();
    expect(labels.verify(A, env({ o: "https://site-a.test", s: "https://site-a.test" }))).toBeNull();
    expect(labels.verify(B, env({ o: "https://xsite-b.test" }))).toBeNull();
    expect(labels.hostOf("https://xsite-b.test")).toBeNull();
  });

  it("asks the service worker once per origin", async () => {
    const asked: string[][] = [];
    const labels = createSiteLabels(
      sites,
      () => "https://site-a.test",
      async (origins) => {
        asked.push(origins);
        return origins.map((origin) => [origin, B] as [string, string]);
      },
    );
    expect(await labels.resolve("https://site-b.test")).toBe(B);
    expect(await labels.resolve("https://site-b.test")).toBe(B);
    expect(asked).toEqual([["https://site-b.test"]]);
  });

  it("keeps a missing answer and takes only hosts of this instance", async () => {
    const asked: string[][] = [];
    const labels = createSiteLabels(
      sites,
      () => "https://site-a.test",
      async (origins) => {
        asked.push(origins);
        return [
          ["https://site-c.test", null],
          ["https://site-d.test", "https://evil.test"],
        ];
      },
    );
    expect(await labels.resolve("https://site-c.test")).toBeNull();
    expect(await labels.resolve("https://site-c.test")).toBeNull();
    expect(await labels.resolve("https://site-d.test")).toBeNull();
    expect(asked).toEqual([["https://site-c.test"], ["https://site-d.test"]]);
  });

  it("shares one lookup between callers and asks again after a failed one", async () => {
    let calls = 0;
    const labels = createSiteLabels(
      sites,
      () => "https://site-a.test",
      async (origins) => {
        calls++;
        if (calls === 1) throw new Error("offline");
        return origins.map((origin) => [origin, B] as [string, string]);
      },
    );
    expect(await labels.resolve("https://site-b.test")).toBeNull();
    const both = await Promise.all([labels.resolve("https://site-b.test"), labels.resolve("https://site-b.test")]);
    expect(both).toEqual([B, B]);
    expect(calls).toBe(2);
  });

  it("knows this instance's other hosts", () => {
    const labels = createSiteLabels(
      sites,
      () => "https://site-a.test",
      async () => [],
    );
    expect(labels.isOtherSiteHost(B)).toBe(true);
    expect(labels.isOtherSiteHost(A)).toBe(false);
    expect(labels.isOtherSiteHost("https://proxy.test")).toBe(false);
    expect(labels.isOtherSiteHost("https://g4fjzasx42nioynauh4u6ncvdg.evil.test")).toBe(false);
    expect(labels.isOtherSiteHost("http://g4fjzasx42nioynauh4u6ncvdg.proxy.test")).toBe(false);
    expect(labels.isOtherSiteHost("null")).toBe(false);
  });

  it("wraps a message with this realm's real origin and site", () => {
    const labels = createSiteLabels(
      sites,
      () => "https://www.site-a.test",
      async () => [],
    );
    const envelope = labels.envelope({ token: "t" }, "https://site-b.test");
    expect(envelope).toEqual({
      "\u0000girici": 1,
      o: "https://www.site-a.test",
      s: "https://site-a.test",
      t: "https://site-b.test",
      d: { token: "t" },
    });
    expect(Object.getPrototypeOf(envelope)).toBeNull();
  });

  it("verifies the same while a page has replaced built-ins", () => {
    const run = () => {
      const labels = createSiteLabels(
        sites,
        () => "https://site-a.test",
        async () => [],
      );
      return [
        labels.verify(B, env({})),
        labels.verify(B, env({ o: "https://evil.test" })),
        labels.verify(B, env({ s: "https://site-c.test" })),
        labels.hostOf("https://www.site-b.test"),
        labels.isOtherSiteHost(B),
        labels.isOtherSiteHost(A),
        labels.envelope(1, "*").o,
      ];
    };
    const expected = run();
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, property, replacement, run), name).toEqual(expected);
    }
  });
});

describe("createLabelLookup", () => {
  it("posts the origins to this host's worker and reads its answer", async () => {
    const requests: Array<[string, RequestInit]> = [];
    const ask = createLabelLookup((url, init) => {
      requests.push([url, init]);
      return Promise.resolve(new Response(JSON.stringify({ hosts: [["https://site-b.test", B]] })));
    }, A);
    expect(await ask(["https://site-b.test"])).toEqual([["https://site-b.test", B]]);
    expect(requests).toEqual([
      [A + LABEL_RPC_PATH, { method: "POST", body: '{"v":2,"origins":["https://site-b.test"]}' }],
    ]);
  });

  it("keeps the worker's answer whatever the page put on Array.prototype", async () => {
    const answer = JSON.stringify({ hosts: [["https://site-b.test", B]] });
    const ask = createLabelLookup(() => Promise.resolve(new Response(answer)), A);
    const labels = createSiteLabels(sites, () => "https://site-a.test", ask);
    const proto = Array.prototype as unknown as { then?: unknown };
    // Settles with a list that has no `then` itself, so a leak shows as a forged host rather than an endless loop.
    proto.then = (settle: (value: unknown) => void) =>
      settle(Object.setPrototypeOf([["https://site-b.test", "https://ijklmnopqrstuvwxyz234567ab.proxy.test"]], null));
    try {
      expect(await labels.resolve("https://site-b.test")).toBe(B);
    } finally {
      delete proto.then;
    }
  });

  it("reads nothing from a broken answer", async () => {
    const lookup = (body: string) => createLabelLookup(() => Promise.resolve(new Response(body)), A);
    expect(await lookup("not json")(["https://site-b.test"])).toEqual([]);
    expect(await lookup('{"hosts":"x"}')(["https://site-b.test"])).toEqual([]);
    const ask = lookup('{"hosts":["x",["https://site-b.test",5]]}');
    expect(await createSiteLabels(sites, () => "https://site-a.test", ask).resolve("https://site-b.test")).toBeNull();
  });
});
