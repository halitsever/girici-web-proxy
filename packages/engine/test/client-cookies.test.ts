import { describe, expect, it } from "vitest";
import { installCookies } from "../src/client/cookies.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

function makeRealm() {
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
      postMessage() {}
    },
  } as unknown as Realm;
  const ctx = { realUrl: () => new URL("https://site.test/") } as unknown as UrlContext;
  return { win, ctx, document };
}

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
});
