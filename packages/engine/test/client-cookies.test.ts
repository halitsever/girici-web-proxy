import { describe, expect, it } from "vitest";
import { installCookies } from "../src/client/cookies.ts";
import { encodeHeaderValue, type CookieSnapshot } from "../src/shared/protocol.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

type Channel = { onmessage: ((event: { data: unknown }) => void) | null };

function makeRealm() {
  const channels: Channel[] = [];
  const Document = { prototype: {} as Record<string, unknown> };
  const document = Object.create(Document.prototype) as { cookie: string };
  const win = {
    document,
    Document,
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ cookies: [] }) }),
    sessionStorage: { getItem: () => null, setItem: () => undefined },
    location: { reload: () => undefined },
    BroadcastChannel: class {
      onmessage: unknown = null;
      constructor() {
        channels.push(this as unknown as Channel);
      }
      postMessage() {}
    },
  } as unknown as Realm;
  const ctx = { realUrl: () => new URL("https://site.test/") } as unknown as UrlContext;
  return { win, ctx, document, channels };
}

const fromOtherTab: CookieSnapshot = {
  name: "t",
  value: "1",
  domain: "site.test",
  path: "/",
  hostOnly: true,
  secure: false,
  expires: null,
  creation: 1,
};

describe("installCookies", () => {
  it("keeps cookie sequence state per realm", () => {
    const a = makeRealm();
    const b = makeRealm();
    const ca = installCookies(a.win, a.ctx, { v: 1, cookies: [] });
    const cb = installCookies(b.win, b.ctx, { v: 1, cookies: [] });
    a.document.cookie = "x=1";
    expect(ca.currentSeq()).toBe(1);
    expect(cb.currentSeq()).toBe(0);
  });

  it("applies cookies that other tabs set", () => {
    const { win, ctx, document, channels } = makeRealm();
    installCookies(win, ctx, { v: 1, cookies: [] });
    channels[0]?.onmessage?.({ data: { type: "cookies", v: 1, changes: [fromOtherTab] } });
    expect(document.cookie).toBe("t=1");
  });

  it("shows no cookies at all in a frame whose cookies are blocked", () => {
    const { win, ctx, document, channels } = makeRealm();
    const bridge = installCookies(win, ctx, { v: 1, cookies: [], cookiesBlocked: true });
    channels[0]?.onmessage?.({ data: { type: "cookies", v: 1, changes: [fromOtherTab] } });
    bridge.applySync(encodeHeaderValue(JSON.stringify([fromOtherTab])));
    document.cookie = "own=1";
    expect(document.cookie).toBe("");
  });
});
