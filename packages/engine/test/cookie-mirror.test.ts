import { describe, expect, it } from "vitest";
import { applyCookieChanges, cookieString, domainMatches, parseScriptCookie } from "../src/shared/cookie-mirror.ts";
import { spyBuiltins } from "./spied-builtins.ts";

const now = Date.UTC(2026, 9, 27);
const page = new URL("https://www.site.test/app/page");

describe("parseScriptCookie", () => {
  it("reads attributes the way document.cookie does", () => {
    expect(parseScriptCookie("a=1; Path=/app; Max-Age=60; Secure", page, now)).toMatchObject({
      name: "a",
      value: "1",
      domain: "www.site.test",
      path: "/app",
      hostOnly: true,
      secure: true,
      expires: now + 60_000,
    });
    expect(parseScriptCookie("b=2; domain=.site.test", page, now)).toMatchObject({
      domain: "site.test",
      hostOnly: false,
      path: "/app",
    });
    expect(parseScriptCookie("c=3; expires=Thu, 01 Jan 1970 00:00:00 GMT", page, now)?.expires).toBe(0);
  });

  it("rejects what scripts may not set", () => {
    for (const input of ["", "x=1; HttpOnly", "x=1; domain=other.test"]) {
      expect(parseScriptCookie(input, page, now)).toBeNull();
    }
  });
});

describe("cookieString", () => {
  it("lists matching, unexpired cookies with longer paths first", () => {
    const base = { hostOnly: true, secure: false, expires: null };
    const cookies = [
      { ...base, name: "a", value: "1", domain: "site.test", path: "/", hostOnly: false, creation: 1 },
      { ...base, name: "b", value: "2", domain: "www.site.test", path: "/app", creation: 2 },
      { ...base, name: "c", value: "3", domain: "www.site.test", path: "/other", creation: 3 },
      { ...base, name: "d", value: "4", domain: "www.site.test", path: "/", secure: true, creation: 4 },
      { ...base, name: "e", value: "5", domain: "www.site.test", path: "/", expires: now - 1, creation: 5 },
      { ...base, name: "f", value: "6", domain: "api.www.site.test", path: "/", creation: 6 },
    ];
    expect(cookieString(cookies, page, now)).toBe("b=2; a=1; d=4");
    expect(cookieString(cookies, new URL("http://www.site.test/app/x"), now)).toBe("b=2; a=1");
  });
});

describe("applyCookieChanges", () => {
  it("replaces cookies by name, domain and path and drops expired ones", () => {
    const base = { domain: "site.test", path: "/", hostOnly: true, secure: false, expires: null, creation: 1 };
    const next = applyCookieChanges(
      [
        { ...base, name: "a", value: "1" },
        { ...base, name: "b", value: "2" },
      ],
      [
        { ...base, name: "a", value: "9", creation: 5 },
        { ...base, name: "b", value: "", expires: 0 },
      ],
      now,
    );
    expect(next.map((c) => `${c.name}=${c.value}`)).toEqual(["a=9"]);
  });
});

describe("cookie mirror on a page's built-ins", () => {
  const secret = "s3cr3t";
  const base = { domain: "www.site.test", hostOnly: true, secure: false, expires: null, creation: 1 };

  it("parses a write without handing its text to the page", async () => {
    let parsed: ReturnType<typeof parseScriptCookie> = null;
    const input = `${secret}=${secret}v; Path=/app; Domain=.site.test; Max-Age=60; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Secure`;
    const url = new URL(`https://www.site.test/app/${secret}`);
    const seen = await spyBuiltins(secret, () => {
      parsed = parseScriptCookie(input, url, now);
    });
    expect(seen).toEqual([]);
    expect(parsed).toMatchObject({
      name: secret,
      value: `${secret}v`,
      domain: "site.test",
      path: "/app",
      hostOnly: false,
      secure: true,
      expires: now + 60_000,
    });
  });

  it("reads expiry and the default path without the page", async () => {
    const parsed: Array<ReturnType<typeof parseScriptCookie>> = [];
    const url = new URL(`https://www.site.test/${secret}/page`);
    const inputs = [`a=${secret}; expires=Thu, 01 Jan 1970 00:00:00 GMT`, `b=${secret}; max-age=x`, secret];
    inputs.push(`c=${secret}; HttpOnly`);
    const seen = await spyBuiltins(secret, () => {
      for (let index = 0; index < inputs.length; index++) {
        parsed[index] = parseScriptCookie(inputs[index] as string, url, now);
      }
    });
    expect(seen).toEqual([]);
    expect(parsed[0]).toMatchObject({ expires: 0, path: `/${secret}` });
    expect(parsed[1]).toMatchObject({ expires: null });
    expect(parsed[2]).toMatchObject({ name: "", value: secret });
    expect(parsed[3]).toBeNull();
  });

  it("builds document.cookie without handing the jar to the page", async () => {
    const cookies = [
      { ...base, name: `${secret}a`, value: "1", path: "/", creation: 1 },
      { ...base, name: `${secret}b`, value: "2", path: "/app", creation: 2 },
      { ...base, name: "", value: `${secret}c`, path: "/app", creation: 3 },
      { ...base, name: `${secret}d`, value: "4", path: "/other", creation: 4 },
      { ...base, name: `${secret}e`, value: "5", path: "/", domain: "site.test", hostOnly: false, creation: 5 },
    ];
    let text = "";
    const url = new URL(`https://www.site.test/app/x?${secret}`);
    const seen = await spyBuiltins(secret, () => {
      text = cookieString(cookies, url, now);
    });
    expect(seen).toEqual([]);
    expect(text).toBe(`${secret}b=2; ${secret}c; ${secret}a=1; ${secret}e=5`);
  });

  it("applies changes without handing the jar to the page", async () => {
    const cookies = [
      { ...base, name: `${secret}a`, value: "1", path: "/" },
      { ...base, name: `${secret}b`, value: "2", path: "/" },
    ];
    const changes = [
      { ...base, name: `${secret}a`, value: `${secret}9`, path: "/", creation: 5 },
      { ...base, name: `${secret}b`, value: "", path: "/", expires: 0 },
    ];
    let next: ReturnType<typeof applyCookieChanges> = [];
    const matches: boolean[] = [];
    const seen = await spyBuiltins(secret, () => {
      next = applyCookieChanges(cookies, changes, now);
      matches[0] = domainMatches(`www.${secret}.test`, `${secret}.test`);
      matches[1] = domainMatches(`${secret}.test`, "test.x");
    });
    expect(seen).toEqual([]);
    expect(next.map((c) => `${c.name}=${c.value}`)).toEqual([`${secret}a=${secret}9`]);
    expect(matches).toEqual([true, false]);
  });
});
