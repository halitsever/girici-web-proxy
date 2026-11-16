import { describe, expect, it } from "vitest";
import { installDocument } from "../src/client/document.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import type { SiteContext } from "../src/shared/protocol.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

function makeRealm() {
  const getters = { get: () => "" };
  const Document = { prototype: {} };
  const Node = { prototype: {} };
  Object.defineProperty(Document.prototype, "referrer", { configurable: true, ...getters });
  Object.defineProperty(Node.prototype, "baseURI", { configurable: true, ...getters });
  const document = Object.create(Document.prototype) as { domain: string };
  const win = { document, Document, Node, DOMException } as unknown as Realm;
  const ctx = {
    origin: "http://proxy.test",
    realUrl: () => new URL("https://www.site.test/"),
  } as unknown as UrlContext;
  return { win, ctx, document };
}

describe("installDocument on a site host", () => {
  const own = "https://k6wjalxihe6pja6woodbryo47k.proxy.test";
  const sites: SiteContext = {
    domain: "proxy.test",
    root: "https://proxy.test",
    label: "k6wjalxihe6pja6woodbryo47k",
    key: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
    site: "https://site-a.test",
    toolbar: true,
    engine: "DuckDuckGo",
  };

  /** The referrer a page reads when the browser reports `native`. */
  function referrerFor(native: string, withSites: boolean): string {
    const Document = { prototype: {} };
    const Node = { prototype: {} };
    Object.defineProperty(Document.prototype, "referrer", { configurable: true, get: () => native });
    Object.defineProperty(Node.prototype, "baseURI", { configurable: true, get: () => "" });
    const document = Object.create(Document.prototype) as Document;
    const win = { document, Document, Node, DOMException } as unknown as Realm;
    const ctx = {
      origin: own,
      realUrl: () => new URL("https://www.site-a.test/page"),
      openSealed: () => null,
    } as unknown as UrlContext;
    installDocument(win, ctx, withSites ? sites : undefined);
    return document.referrer;
  }

  it("hides a referrer from another site host or the root", () => {
    expect(referrerFor("https://g4fjzasx42nioynauh4u6ncvdg.proxy.test/", true)).toBe("");
    expect(referrerFor("https://proxy.test/", true)).toBe("");
    const sameHost = `${own}/~/https/www.site-a.test/previous`;
    expect(referrerFor(sameHost, true)).toBe("https://www.site-a.test/previous");
    expect(referrerFor(sameHost, true)).toBe(referrerFor(sameHost, false));
    expect(referrerFor("https://elsewhere.example/", true)).toBe("https://elsewhere.example/");
  });

  it("hides the same while a page has replaced built-ins", () => {
    const run = () => [
      referrerFor("https://g4fjzasx42nioynauh4u6ncvdg.proxy.test/", true),
      referrerFor("https://proxy.test/", true),
      referrerFor("https://elsewhere.example/", true),
    ];
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, property, replacement, run), name).toEqual(["", "", "https://elsewhere.example/"]);
    }
  });

  it("reports other hosts as before in single-origin mode", () => {
    expect(referrerFor("https://g4fjzasx42nioynauh4u6ncvdg.proxy.test/", false)).toBe(
      "https://g4fjzasx42nioynauh4u6ncvdg.proxy.test/",
    );
  });
});

describe("installDocument", () => {
  it("drops the domain a document set when the window takes a new document", () => {
    const { win, ctx, document } = makeRealm();
    const reset = installDocument(win, ctx);
    document.domain = "site.test";
    expect(document.domain).toBe("site.test");
    reset();
    expect(document.domain).toBe("www.site.test");
  });
});
