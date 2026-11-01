import { describe, expect, it } from "vitest";
import { partitionsToClear, shouldShowToolbar, toolbarHome } from "../src/client/toolbar.ts";
import type { SiteContext } from "../src/shared/protocol.ts";
import { REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const sites: SiteContext = {
  domain: "proxy.test",
  root: "https://proxy.test",
  label: "k6wjalxihe6pja6woodbryo47k",
  key: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  site: "https://site-a.test",
  toolbar: false,
  engine: "Google",
};

describe("shouldShowToolbar", () => {
  it("shows the toolbar only on top-level pages with the switch on", () => {
    expect(shouldShowToolbar({ isTop: true, inherited: false, prefs: null })).toBe(true);
    expect(shouldShowToolbar({ isTop: false, inherited: false, prefs: null })).toBe(false);
    expect(shouldShowToolbar({ isTop: true, inherited: true, prefs: null })).toBe(false);
    expect(shouldShowToolbar({ isTop: true, inherited: false, prefs: '{"toolbar":false}' })).toBe(false);
  });

  it("follows the site settings on a site host", () => {
    expect(
      shouldShowToolbar({ isTop: true, inherited: false, prefs: '{"toolbar":true}', site: { toolbar: false } }),
    ).toBe(false);
    expect(
      shouldShowToolbar({ isTop: true, inherited: false, prefs: '{"toolbar":false}', site: { toolbar: true } }),
    ).toBe(true);
    expect(shouldShowToolbar({ isTop: false, inherited: false, prefs: null, site: { toolbar: true } })).toBe(false);
  });
});

describe("toolbarHome", () => {
  it("sends Home to the root", () => {
    expect(toolbarHome("https://own.proxy.test", sites)).toBe("https://proxy.test/");
    expect(toolbarHome("https://own.proxy.test")).toBe("https://own.proxy.test/");
  });
});

describe("partitionsToClear", () => {
  it("clears every partition when the worker cleared the whole host", () => {
    expect(partitionsToClear({ site: "site-a.test", cookies: 1, all: true })).toBeNull();
    expect(partitionsToClear({ site: "site-a.test", cookies: 1 })).toBe("site-a.test");
  });

  it("reads only the answer's own fields", () => {
    const cleared = withPrototypeAdditions({ all: { value: true, writable: true } }, () =>
      partitionsToClear({ site: "site-a.test", cookies: 1 }),
    );
    expect(cleared).toBe("site-a.test");
  });
});

describe("toolbar choices with built-ins the page replaced", () => {
  it("decides the same", () => {
    const run = () => [
      shouldShowToolbar({ isTop: true, inherited: false, prefs: '{"toolbar":true}', site: { toolbar: false } }),
      toolbarHome("https://own.proxy.test", sites),
      partitionsToClear({ site: "site-a.test", cookies: 1, all: true }),
    ];
    const expected = run();
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      expect(withReplaced(target, property, replacement, run), name).toEqual(expected);
    }
  });
});
