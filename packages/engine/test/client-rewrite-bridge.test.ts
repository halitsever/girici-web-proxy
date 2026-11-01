import { describe, expect, it } from "vitest";
import { createRewriteBridge } from "../src/client/rewrite-bridge.ts";
import { clientTag } from "../src/shared/client-tag.ts";
import { spyBuiltins } from "./spied-builtins.ts";

const CLIENT = "http://proxy.test/_g/client.T.js";
const frameTag = (base: URL) => `<script src="${CLIENT}" data-girici="${base.href}"></script>`;

const ctx = {
  origin: "http://proxy.test",
  realUrl: () => new URL("https://site.test/a/b"),
  realBase: () => new URL("https://site.test/a/b"),
  toProxy: (raw: string) => `/~/https/site.test/${raw}`,
  fromProxy: (value: string) => value.replace("/~/https/site.test/", "https://site.test/"),
};

describe("createRewriteBridge", () => {
  it("rewrites js, html, specifiers and meta urls through the context", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    expect(bridge.js("location.href")).toBe("__g$.L(location).href");
    expect(bridge.html('<a href="https://other.test/">x</a>')).toContain("/~/https/other.test/");
    expect(bridge.importSpecifier("mod.js")).toBe("/~/https/site.test/mod.js");
    expect(bridge.metaUrl("/~/https/site.test/a/b")).toBe("https://site.test/a/b");
  });

  it("rewrites function bodies of every kind", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    expect(bridge.jsBody("return location.href")).toBe("return __g$.L(location).href");
    expect(bridge.jsBody("yield location.href", "generator")).toBe("yield __g$.L(location).href");
    expect(bridge.jsBody("await 0; return location.href", "async")).toBe("await 0; return __g$.L(location).href");
    expect(bridge.jsBody("yield await location.href", "asyncGenerator")).toBe("yield await __g$.L(location).href");
  });

  it("restores real urls in html the page reads back", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    expect(bridge.unhtml('<a href="/~/https/site.test/x">y</a>')).toBe('<a href="https://site.test/x">y</a>');
  });

  it("reads back a srcdoc as the page wrote it", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    const input = '<a href="https://b.test/x">x</a>';
    expect(bridge.srcdoc(input)).toContain("client.T.js");
    expect(bridge.unsrcdoc(bridge.srcdoc(input))).toBe(input);
  });

  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  it("hides the runtime tag when innerHTML of an iframe is read", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    const input = '<a href="https://b.test/x">x</a>';
    const dom = `<iframe srcdoc="${escape(bridge.srcdoc(input))}"></iframe>`;
    expect(dom).toContain("client.T.js");
    expect(bridge.unhtml(dom)).toBe(`<iframe srcdoc="${escape(input)}"></iframe>`);
  });

  it("restores nested srcdoc documents", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    const input = '<iframe srcdoc="<p>x</p>"></iframe>';
    const stored = bridge.srcdoc(input);
    expect(stored.match(/client\.T\.js/g)).toHaveLength(2);
    expect(bridge.unsrcdoc(stored)).toBe(input);
  });

  it("keeps one runtime tag when a rewritten srcdoc is rewritten again", () => {
    const bridge = createRewriteBridge(ctx, frameTag, CLIENT);
    const once = bridge.srcdoc("<p>x</p>");
    expect(bridge.srcdoc(once)).toBe(once);
    const stale = once.replace('data-girici="https://site.test/a/b"', 'data-girici="stale"');
    expect(bridge.srcdoc(stale)).toBe(once);
  });

  it("writes and reads a srcdoc without handing the runtime tag's cookies to the page's built-ins", async () => {
    const client = "http://proxy.test/_g/client.T.js";
    const cookies = [
      { name: "s3cr3t", value: "1", domain: "site.test", path: "/", hostOnly: true, secure: false, expires: null },
    ];
    const tagWithCookies = () => clientTag(client, { v: 2, cookies: [{ ...cookies[0]!, creation: 1 }] });
    const bridge = createRewriteBridge(ctx, tagWithCookies, client);
    const input = "<p>x</p>";
    const out = ["", ""];
    // MagicString builds descriptor literals, which a page's descriptor fields on Object.prototype would break.
    const seen = await spyBuiltins(
      "s3cr3t",
      () => {
        out[0] = bridge.srcdoc(input);
        out[1] = bridge.unsrcdoc(out[0]);
      },
      { descriptorFields: false },
    );
    expect(seen).toEqual([]);
    expect(out[0]).toContain("s3cr3t");
    expect(out[1]).toBe(input);
  });

  it("inherits the page's base, and the markup's base for nested documents", () => {
    const bridge = createRewriteBridge({ ...ctx, realBase: () => new URL("https://site.test/dir/") }, frameTag, CLIENT);
    const out = bridge.srcdoc('<base href="https://cdn.test/d/"><iframe srcdoc="<p>x</p>"></iframe>');
    expect(out.startsWith('<script src="http://proxy.test/_g/client.T.js" data-girici="https://site.test/dir/">')).toBe(
      true,
    );
    expect(out).toContain("data-girici=&quot;https://cdn.test/d/&quot;");
  });
});
