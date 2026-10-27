import { describe, expect, it } from "vitest";
import { applyCookieChanges, cookieString, parseScriptCookie } from "../src/shared/cookie-mirror.ts";

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
