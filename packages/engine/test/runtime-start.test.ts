import { describe, expect, it } from "vitest";
import { start } from "../src/client/runtime.ts";
import type { Realm } from "../src/client/url-context.ts";

/** A window another page's runtime adopted, holding a document whose engine tag records every read. */
function adoptedWindow(renewed: boolean) {
  const log: string[] = [];
  const tag = { remove: () => log.push("remove") };
  const document = {};
  Object.defineProperty(document, "currentScript", {
    get: () => {
      log.push("tag");
      return tag;
    },
  });
  const location = { reload: () => log.push("reload") };
  const win = { document, location, stop: () => log.push("stop") } as unknown as Realm;
  Object.defineProperty(win, "__g$", {
    value: {
      renew: () => {
        log.push("renew");
        return renewed;
      },
    },
  });
  return { win, log };
}

describe("start", () => {
  it("renews the runtime an adopted window carries, then drops the engine tag", () => {
    const { win, log } = adoptedWindow(true);
    start(win);
    expect(log).toEqual(["renew", "tag", "remove"]);
  });

  it("stops a page the adopted runtime refuses and loads it again, without touching its engine tag", () => {
    const { win, log } = adoptedWindow(false);
    start(win);
    expect(log).toEqual(["renew", "stop", "reload"]);
  });
});
