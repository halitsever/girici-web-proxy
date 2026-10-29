import { describe, expect, it } from "vitest";
import { encodeUrl } from "../src/shared/codec.ts";
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
});
const sub = (target: string) => ({
  navigation: false,
  destination: "image" as RequestDestination,
  target: new URL(target),
  referrer: null,
  resultingClientId: "",
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

  it("judges a worker by its own script's site, asking the worker once", async () => {
    let asked = 0;
    const d = deps({
      askTop: async () => {
        asked++;
        return "https://a.test/worker.js";
      },
    });
    const worker: ClientInfo = { id: "w1", type: "worker", frameType: "none", url: "blob:https://girici.test/0a1b" };
    const api = new URL("https://api.a.test/data");
    expect(isThirdParty(api, await topSiteFor(sub(api.href), worker, d))).toBe(false);
    await topSiteFor(sub(api.href), worker, d);
    expect(asked).toBe(1);
  });

  it("learns a worker's site from the referrer its runtime sets, then remembers it", async () => {
    let asked = 0;
    const d = deps({
      askTop: async () => {
        asked++;
        return null;
      },
    });
    const worker: ClientInfo = { id: "w2", type: "worker", frameType: "none", url: "blob:https://girici.test/0c2d" };
    const withReferrer = { ...sub("https://a.test/api"), referrer: proxied("https://a.test/worker.js") };
    expect(await topSiteFor(withReferrer, worker, d)).toBe("https://a.test");
    expect(await topSiteFor(sub("https://a.test/xhr"), worker, d)).toBe("https://a.test");
    expect(asked).toBe(0);
  });

  it("counts an unknown top as third-party", async () => {
    expect(await topSiteFor(nav("https://b.test/", "iframe", null, "f1"), undefined, deps())).toBeNull();
    expect(await topSiteFor(sub("https://b.test/p"), nested("f2", "https://b.test/"), deps())).toBeNull();
    expect(isThirdParty(new URL("https://b.test/p"), null)).toBe(true);
  });
});
