import { hkdfSync } from "node:crypto";
import { siteLabel } from "@girici/engine/shared";
import { describe, expect, it } from "vitest";
import { siteHostFor } from "../src/sites/hosts.ts";
import { deriveSiteKeys } from "../src/sites/keys.ts";
import { siteSetup } from "./helpers/site-app.ts";

describe("deriveSiteKeys", () => {
  it("derives the label key as the worker and the e2e harness do", () => {
    const keys = deriveSiteKeys("s".repeat(32));
    expect(keys.label).toEqual(new Uint8Array(hkdfSync("sha256", "s".repeat(32), "girici", "girici/v1 label", 32)));
    expect(keys.cookies).toEqual(Buffer.from(hkdfSync("sha256", "s".repeat(32), "girici", "girici/v1 cookies", 32)));
    expect(keys.clear).toEqual(Buffer.from(hkdfSync("sha256", "s".repeat(32), "girici", "girici/v1 clear", 32)));
  });

  it("gives each purpose its own key", () => {
    const { label, cookies, clear } = deriveSiteKeys("s".repeat(32));
    const hex = [Buffer.from(label), cookies, clear].map((key) => key.toString("hex"));
    expect(new Set(hex).size).toBe(3);
  });
});

describe("siteHostFor", () => {
  it("names the host of a URL's schemeful site", () => {
    const setup = siteSetup();
    const label = siteLabel(setup.keys.label, "https://site-a.test");
    expect(siteHostFor(new URL("https://www.site-a.test/x"), setup)).toBe(`${label}.proxy.test`);
    expect(siteHostFor(new URL("http://site-a.test/"), setup)).not.toBe(`${label}.proxy.test`);
  });
});
