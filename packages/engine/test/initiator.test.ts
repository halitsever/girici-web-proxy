import { describe, expect, it } from "vitest";
import { MasterSealer } from "../src/shared/sealed-address.ts";
import { parseSiteDomain } from "../src/shared/site-label.ts";
import { CROSS_SITE, isCrossSite, navigationInitiator } from "../src/sw/initiator.ts";
import type { SiteRouting } from "../src/sw/route.ts";

const own = "https://own.proxy.test";
const site: SiteRouting = {
  origin: own,
  domain: parseSiteDomain("proxy.test")!,
  hostOf: (url) => (url.hostname.endsWith("site-b.test") ? "https://bbb.proxy.test" : own),
};

describe("navigationInitiator", () => {
  it("reads a same-host referrer as today", () => {
    expect(navigationInitiator(`${own}/~/https/site-a.test/p`, own, undefined, site)?.href).toBe(
      "https://site-a.test/p",
    );
    const master = new MasterSealer(new Uint8Array(32).fill(3));
    const sealed = master.seal(new URL("https://site-a.test/q"));
    expect(navigationInitiator(own + sealed, own, master.open, site)?.href).toBe("https://site-a.test/q");
  });

  it("calls a referrer from another site host cross-site", () => {
    expect(navigationInitiator("https://bbb.proxy.test/", own, undefined, site)).toBe(CROSS_SITE);
    expect(navigationInitiator("https://bbb.proxy.test/~/x/abc", own, undefined, site)).toBe(CROSS_SITE);
  });

  it("trusts another host's full referrer only when its site lives there", () => {
    expect(navigationInitiator("https://bbb.proxy.test/~/https/site-b.test/p", own, undefined, site)?.href).toBe(
      "https://site-b.test/p",
    );
    expect(navigationInitiator("https://bbb.proxy.test/~/https/site-a.test/p", own, undefined, site)).toBe(CROSS_SITE);
  });

  it("calls a referrer cross-site when no host can be named for its site", () => {
    const blind = { ...site, hostOf: () => null };
    expect(navigationInitiator("https://bbb.proxy.test/~/https/site-b.test/p", own, undefined, blind)).toBe(CROSS_SITE);
  });

  it("treats the root and a missing referrer as a direct navigation", () => {
    expect(navigationInitiator("https://proxy.test/", own, undefined, site)).toBeNull();
    expect(navigationInitiator("https://proxy.test/~/https/site-b.test/p", own, undefined, site)).toBeNull();
    expect(navigationInitiator(null, own, undefined, site)).toBeNull();
  });

  it("keeps today's answer for a foreign referrer and without a site", () => {
    expect(navigationInitiator("https://evil.test/~/https/site-b.test/p", own, undefined, site)).toBeNull();
    expect(navigationInitiator("https://bbb.proxy.test/", own, undefined, null)).toBeNull();
    expect(navigationInitiator(`${own}/~/https/site-a.test/p`, own, undefined, null)?.href).toBe(
      "https://site-a.test/p",
    );
  });
});

describe("CROSS_SITE", () => {
  it("cannot be changed and is told apart from any real URL", () => {
    expect(Object.isFrozen(CROSS_SITE)).toBe(true);
    expect(isCrossSite(CROSS_SITE)).toBe(true);
    expect(isCrossSite(new URL(CROSS_SITE.href))).toBe(false);
    expect(isCrossSite(null)).toBe(false);
  });
});
