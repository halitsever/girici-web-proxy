import { describe, expect, it } from "vitest";
import {
  blobBootstrapHtml,
  blobTreatment,
  installBlobDocuments,
  isBlobUrl,
  loadBlobDocument,
  sandboxedViewerHtml,
} from "../src/client/blob-documents.ts";
import type { InheritedContext } from "../src/shared/protocol.ts";
import type { Invoke } from "../src/client/invoke.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { withReplaced } from "./replaced-builtins.ts";

const origin = "http://p.test";
const direct: Invoke = (fn, self, args) => Reflect.apply(fn, self, args);

describe("blob documents", () => {
  it("treats only HTML as a page, PDF as a viewer and everything else as inert", () => {
    expect(blobTreatment("text/html;charset=windows-1251")).toBe("html");
    expect(blobTreatment("application/pdf")).toBe("pdf");
    for (const type of ["application/xhtml+xml", "image/svg+xml", "text/xml", "text/plain", "", null])
      expect(blobTreatment(type), String(type)).toBe("sandbox");
  });

  it("never takes a type list for a PDF, since the browser may render another of its types", () => {
    expect(blobTreatment("text/html,application/pdf")).toBe("sandbox");
    expect(blobTreatment("application/pdf, text/html")).toBe("sandbox");
    expect(blobTreatment(" Application/PDF ; x=1")).toBe("pdf");
  });

  it("builds the smallest bootstrap that keeps standards mode and the charset", () => {
    expect(blobBootstrapHtml("<script></script>")).toBe('<!doctype html><meta charset="utf-8"><script></script>');
  });

  it("shows non-HTML blobs in a sandboxed frame", () => {
    const html = sandboxedViewerHtml('blob:http://p.test/1"x');
    expect(html).toContain('<iframe sandbox="" src="blob:http://p.test/1&quot;x"');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("html,body{margin:0;height:100%}");
    expect(html).toContain('style="border:0;width:100%;height:100%"></iframe>');
  });

  it("recognises blob URLs the way the URL parser does", () => {
    expect(isBlobUrl("blob:http://p.test/1")).toBe(true);
    expect(isBlobUrl(" BLOB:http://p.test/1")).toBe(true);
    expect(isBlobUrl("bl\nob:http://p.test/1")).toBe(true);
    expect(isBlobUrl("https://a.test/blob:x")).toBe(false);
    expect(isBlobUrl("/blob:x")).toBe(false);
    expect(isBlobUrl("")).toBe(false);
  });
});

/** A realm whose Blob and createObjectURL record what the runtime hands them. */
function blobRealm() {
  const made: Array<{ text: string; type: string | undefined }> = [];
  const timers: Array<() => void> = [];
  class FakeBlob {
    constructor(parts: Iterable<string>, options?: { type?: string }) {
      let text = "";
      for (const part of parts) text += part;
      made.push({ text, type: options?.type });
    }
  }
  const win = {
    Blob: FakeBlob,
    URL: { createObjectURL: () => `blob:${origin}/boot-${made.length}` },
    Element: {
      prototype: {
        getAttribute(this: FakeLink, name: string) {
          return this.attributes.get(name) ?? null;
        },
        setAttribute(this: FakeLink, name: string, value: string) {
          this.attributes.set(name, value);
        },
        hasAttribute(this: FakeLink, name: string) {
          return this.attributes.has(name);
        },
      },
    },
    Document: { prototype: {} },
    setTimeout: (run: () => void) => void timers.push(run),
  } as unknown as Realm;
  return { win, made, timers };
}

interface FakeLink {
  attributes: Map<string, string>;
}

const ctx = {
  origin,
  realBase: () => new URL("https://a.test/dir/page"),
} as UrlContext;

describe("installBlobDocuments", () => {
  it("swaps a blob URL for a bootstrap that names the original and the creator's base", () => {
    const { win, made } = blobRealm();
    const seen: InheritedContext[] = [];
    const blobs = installBlobDocuments(
      win,
      ctx,
      (inherit) => {
        seen.push(inherit);
        return "<script>tag</script>";
      },
      direct,
    );
    expect(blobs.swap(" blob:http://p.test/orig")).toBe(`blob:${origin}/boot-1`);
    expect(seen).toEqual([{ origin, base: "https://a.test/dir/page", blob: "blob:http://p.test/orig" }]);
    expect(made).toEqual([{ text: blobBootstrapHtml("<script>tag</script>"), type: "text/html" }]);
  });

  it("swaps blob URLs whatever global Map the page installed before the realm was adopted", () => {
    const { win } = blobRealm();
    const blobs = withReplaced(globalThis, "Map", { value: class {} }, () =>
      installBlobDocuments(win, ctx, () => "", direct),
    );
    expect(blobs.swap("blob:http://p.test/orig")).toBe(`blob:${origin}/boot-1`);
  });

  it("leaves other URLs and its own bootstraps alone", () => {
    const { win, made } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    expect(blobs.swap("https://a.test/x")).toBe("https://a.test/x");
    expect(blobs.swap("about:blank")).toBe("about:blank");
    const boot = blobs.swap("blob:http://p.test/orig");
    expect(blobs.swap(boot)).toBe(boot);
    expect(made).toHaveLength(1);
  });

  it("keeps a page that replaced the array iterator from choosing the bootstrap", () => {
    const { win, made } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "<script>tag</script>", direct);
    const iterate = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function* () {
      yield "<script>page</script>";
    } as typeof iterate;
    try {
      blobs.swap("blob:http://p.test/orig");
    } finally {
      Array.prototype[Symbol.iterator] = iterate;
    }
    expect(made[0]?.text).toBe(blobBootstrapHtml("<script>tag</script>"));
  });
});

describe("reading back", () => {
  it("maps a bootstrap back to the blob URL the page gave", () => {
    const { win } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    const boot = blobs.swap("blob:http://p.test/orig");
    expect(blobs.original(boot)).toBe("blob:http://p.test/orig");
    expect(blobs.original("https://a.test/")).toBe("https://a.test/");
  });
});

describe("swapLink", () => {
  it("swaps a followed link's blob href until the browser has read it", () => {
    const { win, timers } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    const link = { attributes: new Map([["href", "blob:http://p.test/orig"]]) };
    blobs.swapLink(link);
    expect(link.attributes.get("href")).toBe(`blob:${origin}/boot-1`);
    for (const run of timers) run();
    expect(link.attributes.get("href")).toBe("blob:http://p.test/orig");
  });

  it("leaves downloads, web links and an href the page changed meanwhile alone", () => {
    const { win, timers } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    const download = {
      attributes: new Map([
        ["href", "blob:http://p.test/d"],
        ["download", "x.txt"],
      ]),
    };
    const web = { attributes: new Map([["href", "https://a.test/"]]) };
    blobs.swapLink(download);
    blobs.swapLink(web);
    expect(download.attributes.get("href")).toBe("blob:http://p.test/d");
    expect(web.attributes.get("href")).toBe("https://a.test/");
    const link = { attributes: new Map([["href", "blob:http://p.test/orig"]]) };
    blobs.swapLink(link);
    link.attributes.set("href", "https://a.test/next");
    for (const run of timers) run();
    expect(link.attributes.get("href")).toBe("https://a.test/next");
  });
});

describe("swapLink in SVG and context menus", () => {
  it("swaps an SVG link's xlink:href too", () => {
    const { win } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    const link = { attributes: new Map([["xlink:href", "blob:http://p.test/x"]]) };
    blobs.swapLink(link);
    expect(link.attributes.get("xlink:href")).toBe(`blob:${origin}/boot-1`);
  });

  it("keeps a context menu's swap until the next interaction", () => {
    const { win, timers } = blobRealm();
    const blobs = installBlobDocuments(win, ctx, () => "", direct);
    const link = { attributes: new Map([["href", "blob:http://p.test/orig"]]) };
    blobs.swapLink(link, true);
    for (const run of timers) run();
    expect(link.attributes.get("href")).toBe(`blob:${origin}/boot-1`);
    blobs.restoreLinks();
    expect(link.attributes.get("href")).toBe("blob:http://p.test/orig");
  });
});

/** A document whose open, write and close record their calls/** A document whose open, write and close record their calls, and a location whose replace does the same. */
function documentRealm() {
  const calls: unknown[][] = [];
  const document = {};
  const location = { replace: (url: string) => calls.push(["replace", url]) };
  const win = {
    document,
    location,
    Document: {
      prototype: {
        open: () => calls.push(["open"]),
        write: (text: string) => calls.push(["write", text]),
        close: () => calls.push(["close"]),
      },
    },
  } as unknown as Realm;
  return { win, calls };
}

const respond = (body: BodyInit, type: string) => async () =>
  new Response(body, { headers: type ? { "content-type": type } : {} });

/** The viewer goes through the browser's own write, which the realm's prototype no longer holds. */
const natives = (calls: unknown[][], fetch: unknown, invoke: Invoke = direct) => ({
  fetch: fetch as typeof globalThis.fetch,
  write: (text: string) => void calls.push(["native write", text]),
  revoke: (url: string) => void calls.push(["revoke", url]),
  invoke,
});

describe("loadBlobDocument", () => {
  it("revokes its own bootstrap once it has read the original", async () => {
    const { win, calls } = documentRealm();
    (win.location as { href: string }).href = "blob:http://p.test/boot";
    await loadBlobDocument(win, "blob:http://p.test/h", natives(calls, respond("<p>x</p>", "text/html")));
    expect(calls).toEqual([["revoke", "blob:http://p.test/boot"], ["open"], ["write", "<p>x</p>"], ["close"]]);
  });

  it("writes an HTML blob through the hooked document calls, decoded in its own charset", async () => {
    const { win, calls } = documentRealm();
    const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0xf0, 0xfe]);
    await loadBlobDocument(
      win,
      "blob:http://p.test/h",
      natives(calls, respond(bytes, "text/html;charset=windows-1254")),
    );
    expect(calls).toEqual([["open"], ["write", "<p>ğş"], ["close"]]);
  });

  it("shows anything else in the sandboxed viewer", async () => {
    const { win, calls } = documentRealm();
    await loadBlobDocument(win, "blob:http://p.test/s", natives(calls, respond("<svg/>", "image/svg+xml")));
    expect(calls).toEqual([["open"], ["native write", sandboxedViewerHtml("blob:http://p.test/s")], ["close"]]);
  });

  it("hands a PDF to the browser's viewer through the invoker", async () => {
    const { win, calls } = documentRealm();
    const invoked: unknown[] = [];
    const invoke: Invoke = (fn, self, args) => {
      invoked.push(self);
      return Reflect.apply(fn, self, args);
    };
    await loadBlobDocument(win, "blob:http://p.test/p", natives(calls, respond("%PDF", "application/pdf"), invoke));
    expect(calls).toEqual([["replace", "blob:http://p.test/p"]]);
    expect(invoked).toEqual([win.location]);
  });

  it("decides from the response, not from a then the page replaced", async () => {
    const { win, calls } = documentRealm();
    const nativeFetch = () => {
      const fetched = respond("<p>x</p>", "text/html")();
      // A page that controls then could hand back a PDF response of its own making.
      Object.defineProperty(fetched, "then", {
        value: (ok: (value: Response) => unknown) =>
          ok(new Response("x", { headers: { "content-type": "application/pdf" } })),
      });
      return fetched;
    };
    await loadBlobDocument(win, "blob:http://p.test/h", natives(calls, nativeFetch));
    expect(calls).toEqual([["open"], ["write", "<p>x</p>"], ["close"]]);
  });
});
