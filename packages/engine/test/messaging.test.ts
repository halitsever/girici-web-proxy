import { describe, expect, it } from "vitest";
import { installMessaging } from "../src/client/messaging.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

function ctxFor(realOrigin: string, proxyOrigin: string): UrlContext {
  return { origin: proxyOrigin, realUrl: () => new URL(`${realOrigin}/`) } as unknown as UrlContext;
}

function fakeMessagingWin(calls: unknown[][], proxyOrigin: string): Realm {
  return {
    postMessage(...args: unknown[]) {
      calls.push(args);
    },
    location: { origin: proxyOrigin },
    MessageEvent: { prototype: {} },
  } as unknown as Realm;
}

describe("installMessaging", () => {
  it("delivers to a matching target origin, drops a mismatch and keeps the wildcard", () => {
    const calls: unknown[][] = [];
    const win = fakeMessagingWin(calls, "http://proxy.test");
    // The receiver's real origin is site-a, so only a message addressed to site-a is delivered.
    installMessaging(win, ctxFor("https://site-a.test", "http://proxy.test"));
    win.postMessage("self", "https://site-a.test");
    win.postMessage("other", "https://site-b.test");
    win.postMessage("w", "*");
    expect(calls).toEqual([
      ["self", "http://proxy.test"],
      ["w", "*"],
    ]);
  });
});
