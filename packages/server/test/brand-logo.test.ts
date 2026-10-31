import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, readLogoUpload, sniffLogo } from "../src/brand/logo.ts";
import { readBrandName } from "../src/brand/name.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const b64 = (bytes: Buffer) => bytes.toString("base64");

describe("logo", () => {
  it("names a logo's type from its bytes", () => {
    expect(sniffLogo(PNG)).toBe("image/png");
    expect(sniffLogo(Buffer.from("ffd8ffe000104a464946", "hex"))).toBe("image/jpeg");
    expect(sniffLogo(Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ", "latin1"))).toBe("image/webp");
    expect(
      sniffLogo(Buffer.from('﻿<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe("image/svg+xml");
    expect(sniffLogo(Buffer.from("<html><svg/></html>"))).toBeNull();
    expect(sniffLogo(Buffer.from('<!DOCTYPE svg [<!ENTITY a "x">]><svg/>'))).toBeNull();
    expect(sniffLogo(Buffer.from("GIF89a"))).toBeNull();
  });

  it("accepts a DOCTYPE without an internal subset and refuses invalid UTF-8", () => {
    expect(sniffLogo(Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>'))).toBe(
      "image/svg+xml",
    );
    expect(
      sniffLogo(Buffer.concat([Buffer.from("<svg>"), Buffer.from([0xff, 0xfe]), Buffer.from("</svg>")])),
    ).toBeNull();
  });

  it("refuses an SVG that names another encoding, which browsers would decode differently", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(sniffLogo(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${svg}`))).toBe("image/svg+xml");
    expect(sniffLogo(Buffer.from(`<?xml version='1.0' encoding='utf-8'?>${svg}`))).toBe("image/svg+xml");
    expect(sniffLogo(Buffer.from(`<?xml version="1.0" encoding="ISO-2022-JP"?>${svg}`))).toBeNull();
    expect(sniffLogo(Buffer.from(`<?xml version="1.0" encoding = "windows-1252"?>${svg}`))).toBeNull();
    // ISO-2022-JP switches with escape sequences, which can hide markup from a UTF-8 reading.
    expect(sniffLogo(Buffer.from(`<svg>\x1b(J</svg>`))).toBeNull();
  });

  it("refuses an upload whose bytes do not match its type, or that is too large", () => {
    expect(readLogoUpload({ type: "image/png", data: b64(PNG) })?.type).toBe("image/png");
    expect(readLogoUpload({ type: "image/svg+xml", data: b64(PNG) })).toBeNull();
    expect(readLogoUpload({ type: "image/gif", data: b64(PNG) })).toBeNull();
    expect(readLogoUpload({ type: "image/png", data: "not base64!" })).toBeNull();
    expect(
      readLogoUpload({ type: "image/png", data: b64(Buffer.concat([PNG, Buffer.alloc(MAX_LOGO_BYTES)])) }),
    ).toBeNull();
    expect(readLogoUpload({ type: "image/png", data: "" })).toBeNull();
  });
});

describe("brand name", () => {
  it("accepts a name of up to 40 characters and nothing that could disguise it", () => {
    expect(readBrandName("  Kütüphane  ")).toEqual({ name: "Kütüphane" });
    expect(readBrandName("😀".repeat(40))).toEqual({ name: "😀".repeat(40) });
    expect(readBrandName("x".repeat(41))).toBeNull();
    expect(readBrandName("a\u202Eb")).toBeNull();
    expect(readBrandName("a\nb")).toBeNull();
    expect(readBrandName("")).toEqual({ name: null });
    expect(readBrandName(null)).toEqual({ name: null });
    expect(readBrandName(5)).toBeNull();
  });
});
