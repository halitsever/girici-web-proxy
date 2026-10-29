import { describe, expect, it } from "vitest";
import { generateSetupCode, setupBanner, setupCodeMatches } from "../src/auth/setup-code.ts";

describe("setup code", () => {
  it("makes 12-symbol codes in three groups without look-alike letters", () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(generateSetupCode()).not.toBe(code);
  });

  it("accepts a code typed in lower case or without dashes, and nothing else", () => {
    expect(setupCodeMatches("k7qm 2xpa-9fdr", "K7QM-2XPA-9FDR")).toBe(true);
    expect(setupCodeMatches("K7QM-2XPA-9FDS", "K7QM-2XPA-9FDR")).toBe(false);
    for (const given of [undefined, null, 42, ""]) expect(setupCodeMatches(given, "K7QM-2XPA-9FDR")).toBe(false);
  });

  it("prints a generated code but never one from the environment", () => {
    expect(setupBanner("K7QM-2XPA-9FDR", false)).toBe(
      "Girici setup code: K7QM-2XPA-9FDR\nOpen Girici in a browser and enter this code to create the admin account.\n",
    );
    expect(setupBanner("from-env-secret", true)).toBe(
      "Girici is waiting for setup.\nEnter the code from GIRICI_SETUP_TOKEN on the setup page.\n",
    );
  });
});
