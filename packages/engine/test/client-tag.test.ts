import { describe, expect, it } from "vitest";
import { clientTag, escapeAttribute, stripClientTag } from "../src/shared/client-tag.ts";
import { spyBuiltins } from "./spied-builtins.ts";

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

describe("clientTag against page code", () => {
  it("writes the config it was given, whatever the page put on the prototypes or JSON", () => {
    const config = {
      v: 2,
      cookies: [
        {
          name: "a",
          value: "1",
          domain: "a.test",
          path: "/",
          hostOnly: true,
          secure: false,
          expires: null,
          creation: 1,
        },
      ],
      site: "https://a.test",
      inherit: { origin: "http://p.test", base: "https://a.test/", blob: "blob:http://p.test/1" },
    };
    const clean = clientTag("/_g/c.js", config);
    const forged = () => ({ v: 2, cookies: [], inherit: { origin: "http://p.test", base: "https://b.test/" } });
    const objectProto = Object.prototype as { toJSON?: unknown };
    const arrayProto = Array.prototype as { toJSON?: unknown };
    const stringify = JSON.stringify;
    const replace = String.prototype.replace;
    objectProto.toJSON = forged;
    arrayProto.toJSON = () => [];
    JSON.stringify = () => '{"v":2,"cookies":[],"site":"https://b.test"}';
    String.prototype.replace = function (this: string) {
      return this;
    } as typeof replace;
    let tag: string;
    try {
      tag = clientTag("/_g/c.js", config);
    } finally {
      delete objectProto.toJSON;
      delete arrayProto.toJSON;
      JSON.stringify = stringify;
      String.prototype.replace = replace;
    }
    expect(tag).toBe(clean);
    expect(clean).toContain("https://a.test/");
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

  it("strips the tag without handing the markup or its cookies to the page's built-ins", async () => {
    const url = "http://p.test/_g/client.T.js";
    const cookie = { name: "s3cr3t", value: "1", domain: "a.test", path: "/" };
    const config = { v: 1, cookies: [{ ...cookie, hostOnly: true, secure: false, expires: null, creation: 1 }] };
    const markup = clientTag(url, config) + "<p>s3cr3t</p>";
    let stripped = "";
    const seen = await spyBuiltins("s3cr3t", () => {
      stripped = stripClientTag(markup, url);
    });
    expect(seen).toEqual([]);
    expect(stripped).toBe("<p>s3cr3t</p>");
  });
});

describe("escapeAttribute", () => {
  it("escapes text for a quoted HTML attribute, such as a replayed form field", () => {
    expect(escapeAttribute(`"><script>&'x`)).toBe("&quot;&gt;&lt;script&gt;&amp;&#39;x");
    expect(escapeAttribute("ü plain")).toBe("ü plain");
  });
});
