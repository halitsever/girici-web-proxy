import { describe, expect, it } from "vitest";
import { decodeText, mimeOf, rewriteKind, sandboxesDocument } from "../src/sw/body.ts";

describe("rewriteKind", () => {
  it("rewrites HTML that object and embed elements load", () => {
    expect(rewriteKind("object", false, "text/html")).toBe("html");
    expect(rewriteKind("embed", false, "text/html; charset=utf-8")).toBe("html");
    expect(rewriteKind("image", false, "text/html")).toBeNull();
  });

  it("picks the rewriter from the destination and the content type", () => {
    expect(rewriteKind("document", true, "text/html; charset=utf-8")).toBe("html");
    expect(rewriteKind("iframe", true, "TEXT/HTML")).toBe("html");
    expect(rewriteKind("style", false, "text/css")).toBe("css");
    expect(rewriteKind("style", false, null)).toBe("css");
    expect(rewriteKind("script", false, "application/javascript")).toBe("js");
    expect(rewriteKind("script", false, "text/javascript; charset=utf-8")).toBe("js");
  });

  it("passes everything else through", () => {
    expect(rewriteKind("document", true, "application/pdf")).toBeNull();
    expect(rewriteKind("script", false, "application/json")).toBeNull();
    expect(rewriteKind("", false, "text/html")).toBeNull();
    expect(rewriteKind("image", false, "text/css")).toBeNull();
  });
});

describe("decodeText", () => {
  it("honours the declared charset and falls back to UTF-8", () => {
    const turkish = new Uint8Array([0x54, 0xfc, 0x72, 0x6b, 0xe7, 0x65, 0x20, 0xf0, 0xfe, 0xfd]).buffer;
    expect(decodeText(turkish, "text/html; charset=windows-1254")).toBe("Türkçe ğşı");
    const utf8 = new TextEncoder().encode("ğ").buffer as ArrayBuffer;
    expect(decodeText(utf8, "text/html; charset=x-unknown")).toBe("ğ");
    expect(decodeText(utf8, null)).toBe("ğ");
  });

  it("falls back to the charset a page declares in <meta>", () => {
    const encode = (text: string, ...bytes: number[]) =>
      new Uint8Array([...new TextEncoder().encode(text), ...bytes]).buffer;
    expect(decodeText(encode('<meta charset="windows-1254">', 0xf0, 0xfe, 0xfd), "text/html")).toBe(
      '<meta charset="windows-1254">ğşı',
    );
    expect(
      decodeText(
        encode('<meta http-equiv="Content-Type" content="text/html; charset=windows-1254">', 0xfd),
        "text/html",
      ),
    ).toContain("ı");
    expect(decodeText(encode('<meta charset="windows-1254">', 0xc4, 0x9f), "text/html; charset=utf-8")).toContain("ğ");
  });
});

describe("sandboxesDocument", () => {
  it("sandboxes every document body it does not rewrite, except PDFs and media", () => {
    const cases: Array<[RequestDestination, boolean, string | null]> = [
      ["iframe", true, "text/plain"],
      ["document", true, "image/svg+xml"],
      ["document", true, null],
      ["document", true, "application/xhtml+xml"],
      ["object", false, "image/svg+xml"],
      ["embed", false, "application/octet-stream"],
      ["frame", true, "application/xml"],
    ];
    for (const [destination, navigation, type] of cases)
      expect(sandboxesDocument(destination, navigation, type), `${destination} ${type}`).toBe(true);
    for (const type of ["application/pdf", "video/mp4", "audio/mpeg"])
      expect(sandboxesDocument("document", true, type)).toBe(false);
    expect(sandboxesDocument("image", false, "image/svg+xml")).toBe(false);
    expect(sandboxesDocument("document", true, "text/html")).toBe(false);
  });
});

describe("mimeOf", () => {
  it("reads the type the way a browser does", () => {
    expect(mimeOf("Text/HTML; charset=utf-8")).toBe("text/html");
    expect(mimeOf("video/mp4, text/html")).toBe("text/html");
    expect(mimeOf("text/html, video/mp4")).toBe("video/mp4");
    expect(mimeOf("text/html, */*")).toBe("text/html");
    expect(mimeOf("text/html, foo")).toBe("text/html");
    for (const bad of [null, "", "foo", "text/", "*/*", "a b/c"]) expect(mimeOf(bad), String(bad)).toBeNull();
  });

  it("keeps a comma-joined type from slipping past the rewriter or the media exemption", () => {
    expect(rewriteKind("document", true, "video/mp4, text/html")).toBe("html");
    expect(sandboxesDocument("document", true, "video/mp4, text/html")).toBe(false);
    expect(sandboxesDocument("document", true, "text/html, video/mp4")).toBe(false);
    expect(sandboxesDocument("document", true, "text/plain, video/mp4")).toBe(false);
    expect(sandboxesDocument("document", true, "video/mp4, text/plain")).toBe(true);
  });
});
