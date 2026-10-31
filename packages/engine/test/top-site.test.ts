import { describe, expect, it } from "vitest";
import { installTopSiteResponder } from "../src/client/top-site.ts";
import type { Realm } from "../src/client/url-context.ts";
import { TOP_SITE_QUERY } from "../src/shared/protocol.ts";

const proxy = "http://proxy.test";

function ask(top: unknown): unknown {
  let listener: ((event: unknown) => void) | null = null;
  const container = {
    addEventListener: (_type: string, handler: (event: unknown) => void) => (listener = handler),
    startMessages: () => {},
  } as unknown as ServiceWorkerContainer;
  const win = { top, location: { origin: proxy } } as unknown as Realm;
  installTopSiteResponder(win, () => container);
  let answer: unknown = null;
  listener!({ data: { type: TOP_SITE_QUERY }, ports: [{ postMessage: (value: unknown) => (answer = value) }] });
  return answer;
}

describe("installTopSiteResponder", () => {
  it("answers with the top page's real origin", () => {
    expect(ask({ location: { href: `${proxy}/~/https/www.a.test/p?q` } })).toEqual({ top: "https://www.a.test" });
  });

  it("answers with the top page's real origin when the top has a sealed address", () => {
    const top = { location: { href: `${proxy}/~/x/L.B` }, __g$: { realOrigin: () => "https://a.test" } };
    expect(ask(top)).toEqual({ top: "https://a.test" });
  });

  it("answers nothing for a top it cannot read", () => {
    const hidden = {
      get location(): never {
        throw new Error("cross-origin");
      },
    };
    expect(ask(hidden)).toEqual({ top: null });
  });
});
