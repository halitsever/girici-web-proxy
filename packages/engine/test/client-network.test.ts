import { describe, expect, it } from "vitest";
import type { CookieBridge } from "../src/client/cookies.ts";
import { installNetwork } from "../src/client/network.ts";
import { HEADER } from "../src/shared/protocol.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { recordingCalls } from "./recording-calls.ts";

function fakeWin(log: string[], received: unknown[] = []) {
  // Like the native, a request keeps its address in an internal slot that only the prototype getter reads.
  const addresses = new WeakMap<object, string>();
  class Request {
    readonly mode = "cors";
    readonly headers = { set: (name: string, value: string) => log.push(`header:${name}=${value}`) };
    constructor(input: unknown) {
      addresses.set(this, input instanceof Request ? (addresses.get(input) as string) : String(input));
    }
    get url(): string {
      const address = addresses.get(this);
      if (address === undefined) throw new TypeError("Illegal invocation");
      return address;
    }
  }
  const urlOf = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get as (this: object) => string;
  class XMLHttpRequest {
    open(_method: string, url: string) {
      log.push(`xhr:${url}`);
    }
    send() {
      log.push("send");
    }
    setRequestHeader(name: string, value: string) {
      log.push(`xhr-header:${name}=${value}`);
    }
    addEventListener() {}
  }
  class Navigator {
    sendBeacon(url: string) {
      log.push(`beacon:${url}`);
      return true;
    }
  }
  return {
    fetch: (input: Request) => {
      received.push(input);
      log.push(`fetch:${Reflect.apply(urlOf, input, [])}`);
      return Promise.resolve({ headers: { get: () => null } });
    },
    Request,
    Response: class {},
    XMLHttpRequest,
    EventSource: class {},
    Navigator,
    navigator: new Navigator(),
  };
}

// Proxies anything not yet under /p/, so an already proxied address is left as it is.
const ctx = {
  toProxy: (raw: string) => (raw.startsWith("/p/") ? raw : `/p/${raw}`),
  fromProxy: (value: string) => value.replace(/^\/p\//, ""),
} as unknown as UrlContext;

describe("installNetwork", () => {
  it("never hands a native to a replaced call or apply", () => {
    const log: string[] = [];
    const fake = fakeWin(log);
    const xhr = fake.XMLHttpRequest.prototype;
    const natives = [fake.fetch, xhr.open, xhr.send, xhr.setRequestHeader, fake.Navigator.prototype.sendBeacon];
    const win = fake as unknown as Realm;
    const cookies = { currentSeq: () => 1, applySync: () => {} } as unknown as CookieBridge;
    installNetwork(win, ctx, cookies);
    const seen = recordingCalls(() => {
      void win.fetch("a");
      const request = new win.XMLHttpRequest();
      request.open("GET", "b");
      request.send();
      win.navigator.sendBeacon("c");
    });
    expect(natives.filter((native) => seen.includes(native))).toEqual([]);
    expect(log).toEqual([
      `header:${HEADER.cookieSeq}=1`,
      "fetch:/p/a",
      "xhr:/p/b",
      `xhr-header:${HEADER.cookieSeq}=1`,
      "send",
      "beacon:/p/c",
    ]);
  });

  it("reads a request's address once, through the native getter", () => {
    const log: string[] = [];
    const received: unknown[] = [];
    const fake = fakeWin(log, received);
    const win = fake as unknown as Realm;
    installNetwork(win, ctx, { currentSeq: () => 0, applySync: () => {} } as unknown as CookieBridge);

    const foreign = new fake.Request("https://evil.test/x");
    let reads = 0;
    // Answers the foreign address first, then its proxied form, so a second read would look already proxied.
    Object.defineProperty(foreign, "url", {
      get: () => (reads++ % 2 === 0 ? "https://evil.test/x" : "/p/https://evil.test/x"),
    });
    void win.fetch(foreign as unknown as Request);
    expect(log).toEqual(["fetch:/p/https://evil.test/x"]);
    expect(received[0]).not.toBe(foreign);

    const proxied = new fake.Request("/p/https://a.test/y");
    void win.fetch(proxied as unknown as Request);
    expect(received[1]).toBe(proxied);
  });
});
