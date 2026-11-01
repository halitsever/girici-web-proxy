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

  it("reads the visited cookies that verify", () => {
    const value = signVisited(["https://site-a.test"], keys);
    expect(readVisited(`girici-sites=junk; __Secure-girici-sites=${value}`, keys)).toEqual(["https://site-a.test"]);
    expect(readVisited(`girici-sites=${signVisited(["x"], other)}`, keys)).toEqual([]);
    expect(readVisited(undefined, keys)).toEqual([]);
  });

  it("lists the sites of every visited value that verifies, so another value cannot hide them", () => {
    const empty = signVisited([], keys);
    const listed = signVisited(["https://site-a.test", "https://site-b.test"], keys);
    const own = signVisited(["https://site-c.test", "https://site-a.test"], keys);
    const header = `__Secure-girici-sites=${empty}; __Secure-girici-sites=${listed}; girici-sites=${own}`;
    expect(readVisited(header, keys)).toEqual(["https://site-a.test", "https://site-b.test", "https://site-c.test"]);
  });
});

describe("the settings cookie", () => {
  it("reads the prefs cookie that verifies", () => {
    const prefs = { ...DEFAULT_SITE_PREFS, toolbar: false, engine: "Bing" as const };
    const header = `a=b; girici-prefs=junk; girici-prefs=${signPrefs(prefs, keys)}; __Secure-girici-prefs=${signPrefs(
      { ...prefs, toolbar: true },
      keys,
    )}`;
    expect(readPrefsCookie(header, keys)).toEqual(prefs);
    expect(readPrefsCookie("girici-prefs=junk", keys)).toEqual(DEFAULT_SITE_PREFS);
    expect(readPrefsCookie(undefined, keys)).toEqual(DEFAULT_SITE_PREFS);
  });

  it("keeps blocking and sealing on when any value that verifies has them on", () => {
    const open = signPrefs({ ...DEFAULT_SITE_PREFS, blockThirdPartyCookies: false, sealAddresses: false }, keys);
    const sealed = signPrefs({ ...DEFAULT_SITE_PREFS, blockThirdPartyCookies: false, sealAddresses: true }, keys);
    const blocking = signPrefs({ ...DEFAULT_SITE_PREFS, blockThirdPartyCookies: true, sealAddresses: false }, keys);
    const read = (header: string) => {
      const { blockThirdPartyCookies, sealAddresses } = readPrefsCookie(header, keys);
      return { blockThirdPartyCookies, sealAddresses };
    };
    expect(read(`__Secure-girici-prefs=${open}`)).toEqual({ blockThirdPartyCookies: false, sealAddresses: false });
    expect(read(`__Secure-girici-prefs=${open}; __Secure-girici-prefs=${sealed}`)).toEqual({
      blockThirdPartyCookies: false,
      sealAddresses: true,
    });
    expect(read(`__Secure-girici-prefs=${open}; girici-prefs=${blocking}; __Secure-girici-prefs=junk`)).toEqual({
      blockThirdPartyCookies: true,
      sealAddresses: false,
    });
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
