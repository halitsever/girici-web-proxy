import { describe, expect, it } from "vitest";
import { clientTag, stripClientTag } from "../src/shared/client-tag.ts";

describe("clientTag", () => {
  it("embeds the config as an escaped attribute", () => {
    expect(clientTag("/_g/client.abc.js", { v: 1, cookies: [] })).toBe(
      '<script src="/_g/client.abc.js" data-girici="{&quot;v&quot;:1,&quot;cookies&quot;:[]}"></script>',
    );
    const cookie = {
      name: "a",
      value: "<&'>",
      domain: "site.test",
      path: "/",
      hostOnly: true,
      secure: false,
      expires: null,
      creation: 1,
    };
    expect(clientTag("/_g/c.js", { v: 1, cookies: [cookie] })).toContain("&lt;&amp;&#39;&gt;");
  });
});

describe("stripClientTag", () => {
  it("strips the injected runtime tag and nothing else", () => {
    const url = "http://p.test/_g/client.T.js";
    expect(stripClientTag(clientTag(url, { v: 1, cookies: [] }) + "<p>x</p>", url)).toBe("<p>x</p>");
    expect(stripClientTag("<p>x</p>", url)).toBe("<p>x</p>");
    expect(stripClientTag('<script src="/other.js"></script><p>x</p>', url)).toBe(
      '<script src="/other.js"></script><p>x</p>',
    );
  });
});
