import { describe, expect, it } from "vitest";
import type { CookieBridge } from "../src/client/cookies.ts";
import { installNetwork } from "../src/client/network.ts";
import { HEADER } from "../src/shared/protocol.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { recordingCalls } from "./recording-calls.ts";

function fakeWin(log: string[]) {
  class Request {
    readonly url: string;
    readonly mode = "cors";
    readonly headers = { set: (name: string, value: string) => log.push(`header:${name}=${value}`) };
    constructor(input: unknown) {
      this.url = input instanceof Request ? input.url : String(input);
    }
  }
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
      log.push(`fetch:${input.url}`);
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

describe("installNetwork", () => {
  it("never hands a native to a replaced call or apply", () => {
    const log: string[] = [];
    const fake = fakeWin(log);
    const xhr = fake.XMLHttpRequest.prototype;
    const natives = [fake.fetch, xhr.open, xhr.send, xhr.setRequestHeader, fake.Navigator.prototype.sendBeacon];
    const win = fake as unknown as Realm;
    const ctx = { toProxy: (raw: string) => `/p/${raw}` } as unknown as UrlContext;
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
});
