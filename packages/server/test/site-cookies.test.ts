import { DEFAULT_SITE_PREFS, parseSiteDomain } from "@girici/engine/shared";
import { describe, expect, it } from "vitest";
import {
  readPrefsCookie,
  readVisited,
  rememberSite,
  signPrefs,
  signVisited,
  siteCookie,
  VISITED_LIMIT_BYTES,
} from "../src/sites/cookies.ts";
import { deriveSiteKeys } from "../src/sites/keys.ts";
import { openValue, signValue } from "../src/sites/signed.ts";

const keys = deriveSiteKeys("s".repeat(32));
const other = deriveSiteKeys("t".repeat(32));

describe("signed values", () => {
  it("signs values and refuses a changed one", () => {
    const value = signValue(keys.cookies, "prefs", { toolbar: false });
    expect(value).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(openValue(keys.cookies, "prefs", value)).toEqual({ toolbar: false });
    const [body, mac] = value.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ toolbar: true })).toString("base64url");
    expect(openValue(keys.cookies, "prefs", `${forged}.${mac}`)).toBeNull();
    expect(openValue(keys.cookies, "prefs", `${body}.${mac.slice(1)}x`)).toBeNull();
    expect(openValue(keys.cookies, "sites", value)).toBeNull();
    expect(openValue(other.cookies, "prefs", value)).toBeNull();
    for (const junk of ["", "junk", ".", `${body}.`, `.${mac}`])
      expect(openValue(keys.cookies, "prefs", junk)).toBeNull();
  });
});

describe("visited sites", () => {
  it("remembers the newest site first and within the size limit", () => {
    let list: string[] = [];
    for (let index = 0; index < 400; index++) list = rememberSite(list, `https://site-${index}.example`);
    expect(signVisited(list, keys).length).toBeLessThanOrEqual(VISITED_LIMIT_BYTES);
    expect(list[0]).toBe("https://site-399.example");
    expect(list.length).toBeGreaterThan(50);
    const again = rememberSite(list, list[5]!);
    expect(again[0]).toBe(list[5]);
    expect(again).toHaveLength(list.length);
  });

  it("reads the first visited cookie that verifies", () => {
    const value = signVisited(["https://site-a.test"], keys);
    expect(readVisited(`girici-sites=junk; __Secure-girici-sites=${value}`, keys)).toEqual(["https://site-a.test"]);
    expect(readVisited(`girici-sites=${signVisited(["x"], other)}`, keys)).toEqual([]);
    expect(readVisited(undefined, keys)).toEqual([]);
  });
});

describe("the settings cookie", () => {
  it("reads the first prefs cookie that verifies", () => {
    const prefs = { ...DEFAULT_SITE_PREFS, toolbar: false, engine: "Bing" as const };
    const header = `a=b; girici-prefs=junk; girici-prefs=${signPrefs(prefs, keys)}; __Secure-girici-prefs=${signPrefs(
      DEFAULT_SITE_PREFS,
      keys,
    )}`;
    expect(readPrefsCookie(header, keys)).toEqual(prefs);
    expect(readPrefsCookie("girici-prefs=junk", keys)).toEqual(DEFAULT_SITE_PREFS);
    expect(readPrefsCookie(undefined, keys)).toEqual(DEFAULT_SITE_PREFS);
  });

  it("sets each cookie for the whole domain under /_g/sites", () => {
    const domain = parseSiteDomain("proxy.test:8443")!;
    expect(siteCookie("prefs", "v.s", domain, true)).toBe(
      "__Secure-girici-prefs=v.s; Max-Age=34560000; Domain=proxy.test; Path=/_g/sites; HttpOnly; Secure; SameSite=Lax",
    );
    expect(siteCookie("sites", "v.s", domain, false)).toBe(
      "girici-sites=v.s; Max-Age=34560000; Domain=proxy.test; Path=/_g/sites; HttpOnly; SameSite=Lax",
    );
  });
});
