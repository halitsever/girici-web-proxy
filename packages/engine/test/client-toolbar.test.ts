import { describe, expect, it } from "vitest";
import { shouldShowToolbar } from "../src/client/toolbar.ts";

describe("shouldShowToolbar", () => {
  it("shows the toolbar only on top-level pages with the switch on", () => {
    expect(shouldShowToolbar({ isTop: true, inherited: false, prefs: null })).toBe(true);
    expect(shouldShowToolbar({ isTop: false, inherited: false, prefs: null })).toBe(false);
    expect(shouldShowToolbar({ isTop: true, inherited: true, prefs: null })).toBe(false);
    expect(shouldShowToolbar({ isTop: true, inherited: false, prefs: '{"toolbar":false}' })).toBe(false);
  });
});
