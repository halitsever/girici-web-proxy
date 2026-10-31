import { describe, expect, it } from "vitest";
import { installDocument } from "../src/client/document.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";

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
