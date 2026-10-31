import { describe, expect, it } from "vitest";
import { installTopSiteResponder } from "../src/client/top-site.ts";
import type { Realm } from "../src/client/url-context.ts";
import { TOP_SITE_QUERY } from "../src/shared/protocol.ts";
import { REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const proxy = "http://proxy.test";

function responder() {
  let handler: ((event: unknown) => void) | null = null;
  const container = {
    addEventListener: (_type: string, listener: (event: unknown) => void) => (handler = listener),
    startMessages: () => {},
  } as unknown as ServiceWorkerContainer;
  const win = { location: { origin: proxy, href: `${proxy}/~/https/a.test/page?q=1` } } as unknown as Realm;
  (win as unknown as { top: unknown }).top = win;
  installTopSiteResponder(win, () => container);
  const ask = (data: unknown): unknown[] => {
    const answers: unknown[] = [];
    handler?.({ data, ports: [{ postMessage: (answer: unknown) => answers.push(answer) }] });
    return answers;
  };
  return ask;
}

describe("installTopSiteResponder", () => {
  it("answers with the real top URL", () => {
    expect(responder()({ type: TOP_SITE_QUERY })).toEqual([{ top: "https://a.test/page?q=1" }]);
  });

  it("answers only a query named by the message itself", () => {
    const ask = responder();
    const answers = withPrototypeAdditions({ type: { value: TOP_SITE_QUERY, writable: true } }, () => ask({}));
    expect(answers).toEqual([]);
  });

  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`reads the top URL when ${name} is replaced`, () => {
      const ask = responder();
      expect(withReplaced(target, key, replacement, () => ask({ type: TOP_SITE_QUERY }))).toEqual([
        { top: "https://a.test/page?q=1" },
      ]);
    });
  }
});
