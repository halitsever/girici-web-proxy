import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classifySiteHost,
  isSiteLabel,
  parseSiteDomain,
  SITE_LABEL_LENGTH,
  siteHostOrigin,
  siteLabel,
} from "../src/shared/site-label.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const key = new Uint8Array(32).fill(7);

describe("site labels", () => {
  it("labels a site with 26 lowercase base32 characters", () => {
    expect(siteLabel(key, "https://site-a.test")).toBe("k6wjalxihe6pja6woodbryo47k");
    expect(siteLabel(key, "https://site-b.test")).toBe("g4fjzasx42nioynauh4u6ncvdg");
    expect(siteLabel(key, "http://site-c.test")).toBe("4mzwumrqhmnxnr6txauqgwql6j");
    expect(SITE_LABEL_LENGTH).toBe(26);
  });

  it("labels as node:crypto would", () => {
    const A = "abcdefghijklmnopqrstuvwxyz234567";
    for (let round = 0; round < 50; round++) {
      const k = randomBytes(32);
      const site = `https://${randomBytes(6).toString("hex")}.example`;
      const mac = createHmac("sha256", k).update(`girici/v1 site\0${site}`).digest();
      let bits = "";
      for (const byte of mac) bits += byte.toString(2).padStart(8, "0");
      let expected = "";
      for (let index = 0; index < 26; index++) expected += A[parseInt(bits.slice(index * 5, index * 5 + 5), 2)];
      expect(siteLabel(k, site)).toBe(expected);
    }
  });

  it("gives the same label while a page has replaced built-ins", () => {
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      withReplaced(target, property, replacement, () =>
        expect(siteLabel(key, "https://site-a.test"), name).toBe("k6wjalxihe6pja6woodbryo47k"),
      );
    }
  });

  it("knows a label by its length and alphabet", () => {
    expect(isSiteLabel("k6wjalxihe6pja6woodbryo47k")).toBe(true);
    for (const bad of ["", "k6wjalxihe6pja6woodbryo47", "k6wjalxihe6pja6woodbryo47kk", "K6WJALXIHE6PJA6WOODBRYO47K"]) {
      expect(isSiteLabel(bad), bad).toBe(false);
    }
    expect(isSiteLabel("k6wjalxihe6pja6woodbryo40k")).toBe(false);
    expect(isSiteLabel("k6wjalxihe6pja6woodbryo48k")).toBe(false);
    expect(isSiteLabel("k6wjalxihe6pja6woodbryo-7k")).toBe(false);
  });

  it("reads a site domain with an optional port", () => {
    expect(parseSiteDomain("Proxy.Example")).toEqual({ host: "proxy.example", port: "", value: "proxy.example" });
    expect(parseSiteDomain("girici.localhost:41005")).toEqual({
      host: "girici.localhost",
      port: "41005",
      value: "girici.localhost:41005",
    });
    for (const bad of [
      "localhost",
      "https://proxy.example",
      "proxy.example/",
      "proxy.example.",
      "1.2.3.4",
      "[::1]",
      "-a.example",
      "a..example",
      "proxy.example:0",
      "proxy.example:70000",
      `${"a".repeat(64)}.example`,
      `${"a.".repeat(113)}ex`,
      "",
    ]) {
      expect(parseSiteDomain(bad), bad).toBeNull();
    }
  });

  it("refuses the domain spellings a Host header never carries", () => {
    for (const bad of [
      "a-.example",
      "proxy_x.example",
      "proxy.example:",
      "proxy.example:041005",
      "proxy.example:12a",
      " proxy.example",
      "türk.example",
      ".proxy.example",
      "user@proxy.example",
      "proxy.123",
      "proxy.0x1F",
      "proxy.0x",
    ]) {
      expect(parseSiteDomain(bad), bad).toBeNull();
    }
    expect(parseSiteDomain(`${"a.".repeat(112)}ex`)?.host).toHaveLength(226);
    expect(parseSiteDomain(`${"a".repeat(63)}.example`)).not.toBeNull();
    expect(parseSiteDomain("xn--trk-yla.example:65535")?.value).toBe("xn--trk-yla.example:65535");
    expect(parseSiteDomain("1.2.3.0xg")?.host).toBe("1.2.3.0xg");
    expect(parseSiteDomain("proxy.x0")?.host).toBe("proxy.x0");
  });

  it("tells the root, a site host and anything else apart", () => {
    const domain = parseSiteDomain("proxy.example")!;
    const label = "k6wjalxihe6pja6woodbryo47k";
    expect(classifySiteHost("proxy.example", domain)).toEqual({ kind: "root" });
    expect(classifySiteHost("PROXY.example", domain)).toEqual({ kind: "root" });
    expect(classifySiteHost(`${label}.proxy.example`, domain)).toEqual({ kind: "site", label });
    for (const other of [
      undefined,
      "",
      "www.proxy.example",
      "proxy.example:3000",
      `${label.slice(1)}.proxy.example`,
      `a.${label}.proxy.example`,
      `${label}.proxy.example.`,
      "evilproxy.example",
      "127.0.0.1:3000",
      "k6wjalxihe6pja6woodbryo40k.proxy.example",
    ]) {
      expect(classifySiteHost(other, domain), String(other)).toEqual({ kind: "other" });
    }
    const local = parseSiteDomain("girici.localhost:41005")!;
    expect(classifySiteHost("girici.localhost:41005", local)).toEqual({ kind: "root" });
    expect(classifySiteHost("girici.localhost", local)).toEqual({ kind: "other" });
    expect(siteHostOrigin("http:", label, local)).toBe(`http://${label}.girici.localhost:41005`);
  });

  it("reads domains and hosts the same while a page has replaced built-ins", () => {
    const label = "k6wjalxihe6pja6woodbryo47k";
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      withReplaced(target, property, replacement, () => {
        const domain = parseSiteDomain("Girici.Localhost:41005");
        expect(domain, name).toEqual({ host: "girici.localhost", port: "41005", value: "girici.localhost:41005" });
        expect(parseSiteDomain("1.2.3.4"), name).toBeNull();
        expect(isSiteLabel(label), name).toBe(true);
        expect(isSiteLabel("k6wjalxihe6pja6woodbryo40k"), name).toBe(false);
        expect(classifySiteHost(`${label}.GIRICI.localhost:41005`, domain!), name).toEqual({ kind: "site", label });
        expect(classifySiteHost("girici.localhost:41005", domain!), name).toEqual({ kind: "root" });
        expect(classifySiteHost(`x${label}.girici.localhost:41005`, domain!), name).toEqual({ kind: "other" });
        expect(siteHostOrigin("https:", label, domain!), name).toBe(`https://${label}.girici.localhost:41005`);
      });
    }
  });
});
