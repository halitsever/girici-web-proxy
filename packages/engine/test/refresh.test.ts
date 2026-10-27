import { describe, expect, it } from "vitest";
import { rewriteRefresh } from "../src/rewrite/refresh.ts";

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
