import { describe, expect, it } from "vitest";
import { rewriteRefresh } from "../src/rewrite/refresh.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const base = new URL("https://site.test/dir/page.html");

describe("rewriteRefresh", () => {
  it("rewrites the target and normalises the syntax", () => {
    expect(rewriteRefresh("5; url=https://x.test/a", base, "http://proxy.test")).toBe("5; url=/~/https/x.test/a");
    expect(rewriteRefresh("0;URL='/b'", base, "http://proxy.test")).toBe("0; url=/~/https/site.test/b");
    expect(rewriteRefresh("0; url=page2", base, "http://proxy.test")).toBe("0; url=page2");
  });

  it("leaves values without a target or with an unknown syntax alone", () => {
    expect(rewriteRefresh("3", base, "http://proxy.test")).toBe("3");
    expect(rewriteRefresh("soon", base, "http://proxy.test")).toBe("soon");
  });
});

describe("rewriteRefresh with built-ins the page replaced", () => {
  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`keeps the target proxied when ${name} is replaced`, () => {
      const rewritten = withReplaced(target, key, replacement, () =>
        rewriteRefresh("5; url=https://x.test/a", base, "http://proxy.test"),
      );
      expect(rewritten).toBe("5; url=/~/https/x.test/a");
    });
  }
});
