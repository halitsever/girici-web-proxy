import { describe, expect, it } from "vitest";
import { encodeUrl } from "../src/shared/codec.ts";
import { MasterSealer } from "../src/shared/sealed-address.ts";
import { FrameTops, isThirdParty, topSiteFor, type ClientInfo, type TopSiteDeps } from "../src/sw/third-party.ts";

const origin = "https://girici.test";
const proxied = (url: string) => new URL(encodeUrl(new URL(url)), origin).href;

function deps(
  overrides: { clients?: ClientInfo[]; askTop?: (clientId: string) => Promise<string | null> } = {},
): TopSiteDeps {
  return {
    frames: new FrameTops(),
    origin,
    windowClients: async () => overrides.clients ?? [],
    askTop: overrides.askTop ?? (async () => null),
    workers: async () => null,
  };
}

const nav = (
  target: string,
  destination: RequestDestination,
  referrer: string | null = null,
  resultingClientId = "",
) => ({
  navigation: true,
  destination,
  target: new URL(target),
  referrer,
  resultingClientId,
  clientId: "",
});
const sub = (target: string) => ({
  navigation: false,
  destination: "image" as RequestDestination,
  target: new URL(target),
  referrer: null,
  resultingClientId: "",
  clientId: "",
});
const top = (id: string, url: string): ClientInfo => ({
  id,
  type: "window",
  frameType: "top-level",
  url: proxied(url),
});
const nested = (id: string, url: string): ClientInfo => ({
  id,
  type: "window",
  frameType: "nested",
  url: proxied(url),
});

describe("topSiteFor", () => {
  it("treats top-level navigations as first-party", async () => {
    expect(await topSiteFor(nav("https://www.b.test/", "document"), undefined, deps())).toBe("https://b.test");
  });

  it("judges a top page's requests by that page's site", async () => {
    const d = deps();
    const page = top("t", "https://a.test/");
    const cdn = new URL("https://cdn.a.test/x.png");
    const tracker = new URL("https://tracker.test/p");
    expect(isThirdParty(cdn, await topSiteFor(sub(cdn.href), page, d))).toBe(false);
    expect(isThirdParty(tracker, await topSiteFor(sub(tracker.href), page, d))).toBe(true);
  });

  it("gives an iframe its parent's top and applies it to the frame's own requests", async () => {
    const parent = top("t", "https://a.test/");
    const d = deps({ clients: [parent] });
    expect(await topSiteFor(nav("https://tracker.test/frame", "iframe", parent.url, "f1"), undefined, d)).toBe(
      "https://a.test",
    );
    const frame = nested("f1", "https://tracker.test/frame");
    const pixel = new URL("https://tracker.test/pixel");
    expect(isThirdParty(pixel, await topSiteFor(sub(pixel.href), frame, d))).toBe(true);
  });

  it("passes the top down to grandchild frames", async () => {
    const parent = top("t", "https://a.test/");
    const child = nested("f1", "https://b.test/");
    const d = deps({ clients: [parent, child] });
    await topSiteFor(nav("https://b.test/", "iframe", parent.url, "f1"), undefined, d);
    expect(await topSiteFor(nav("https://c.test/", "iframe", child.url, "f2"), undefined, d)).toBe("https://a.test");
  });

  it("asks a nested frame for its top after a restart and remembers the answer", async () => {
    let asked = 0;
    const d = deps({
      askTop: async () => {
        asked++;
        return "https://a.test/page";
      },
    });
    const frame = nested("f9", "https://tracker.test/frame");
    expect(await topSiteFor(sub("https://tracker.test/p"), frame, d)).toBe("https://a.test");
    expect(await topSiteFor(sub("https://tracker.test/p"), frame, d)).toBe("https://a.test");
    expect(asked).toBe(1);
  });

  it("finds a parent frame whose address carries a fragment", async () => {
    const parent = top("t", "https://a.test/");
    const widget = {
      ...nested("w", "https://tracker.test/widget"),
      url: `${proxied("https://tracker.test/widget")}#cfg`,
    };
    const d = deps({ clients: [parent, widget] });
    await topSiteFor(nav("https://tracker.test/widget", "iframe", parent.url, "w"), undefined, d);
    const referrer = proxied("https://tracker.test/widget");
    expect(await topSiteFor(nav("https://tracker.test/sync", "iframe", referrer, "s"), undefined, d)).toBe(
      "https://a.test",
    );
  });

  it("does not remember a top it could only guess from the referrer", async () => {
    let asked = 0;
    const d = deps({
      askTop: async () => {
        asked++;
        return "https://a.test/";
      },
    });
    const referrer = proxied("https://tracker.test/widget");
    expect(await topSiteFor(nav("https://tracker.test/sync", "iframe", referrer, "s"), undefined, d)).toBe(
      "https://tracker.test",
    );
    expect(await topSiteFor(sub("https://tracker.test/p"), nested("s", "https://tracker.test/sync"), d)).toBe(
      "https://a.test",
    );
    expect(asked).toBe(1);
  });

  it("judges a worker by the page that started it, whatever referrer it sends", async () => {
    let asked = 0;
    const d = {
      ...deps({ askTop: async () => (asked++, "https://b.test/") }),
      workers: async () => ({ page: "https://a.test/app", top: "https://a.test" }),
    };
    const worker: ClientInfo = { id: "w1", type: "worker", frameType: "none", url: "blob:https://girici.test/0a1b" };
    const forged = { ...sub("https://b.test/api"), referrer: proxied("https://b.test/"), clientId: "w1" };
    expect(isThirdParty(new URL("https://b.test/api"), await topSiteFor(forged, worker, d))).toBe(true);
    expect(asked).toBe(0);
  });

  it("counts a worker nobody announced as third-party", async () => {
    const d = { ...deps(), workers: async () => null };
    const worker: ClientInfo = { id: "w9", type: "worker", frameType: "none", url: "blob:https://girici.test/9" };
    expect(
      await topSiteFor({ ...sub("https://a.test/x"), referrer: proxied("https://a.test/"), clientId: "w9" }, worker, d),
    ).toBeNull();
  });

  it("judges a client that cannot be looked up by its binding, never by its referrer", async () => {
    const bound = {
      ...deps(),
      workers: async (id: string) => (id === "w1" ? { page: "https://a.test/", top: "https://a.test" } : null),
    };
    const forged = { ...sub("https://b.test/api"), referrer: proxied("https://b.test/") };
    expect(await topSiteFor({ ...forged, clientId: "w1" }, undefined, bound)).toBe("https://a.test");
    expect(await topSiteFor({ ...forged, clientId: "w2" }, undefined, bound)).toBeNull();
    expect(await topSiteFor(forged, undefined, bound)).toBeNull();
  });

  it("counts an unknown top as third-party", async () => {
    expect(await topSiteFor(nav("https://b.test/", "iframe", null, "f1"), undefined, deps())).toBeNull();
    expect(await topSiteFor(sub("https://b.test/p"), nested("f2", "https://b.test/"), deps())).toBeNull();
    expect(isThirdParty(new URL("https://b.test/p"), null)).toBe(true);
  });
});

describe("sealed top-level windows", () => {
  const master = new MasterSealer(new Uint8Array(32).fill(3));
  const sealedTop: ClientInfo = {
    id: "t",
    type: "window",
    frameType: "top-level",
    url: origin + master.seal(new URL("https://www.a.test/p")),
  };

  it("reads the site of a sealed top-level window", async () => {
    expect(await topSiteFor(sub("https://cdn.a.test/x"), sealedTop, { ...deps(), open: master.open })).toBe(
      "https://a.test",
    );
    expect(await topSiteFor(sub("https://cdn.a.test/x"), sealedTop, deps())).toBeNull();
  });

  it("gives a frame of a sealed page that page's site", async () => {
    const d = { ...deps({ clients: [sealedTop] }), open: master.open };
    expect(await topSiteFor(nav("https://www.a.test/f", "iframe", sealedTop.url, "f1"), undefined, d)).toBe(
      "https://a.test",
    );
  });
});
