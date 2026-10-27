import { describe, expect, it } from "vitest";
import { decodeText, rewriteKind } from "../src/sw/body.ts";

describe("rewriteKind", () => {
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
});
