import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  createSiteSessionToken,
  PLAIN_SESSION_COOKIE,
  PLAIN_SITE_SESSION_COOKIE,
  readSession,
  readSiteSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SITE_SESSION_COOKIE,
} from "../src/auth/cookie.ts";

const secret = "cookie-secret";

describe("session cookie", () => {
  it("round-trips the admin id and issue time through a cookie header", () => {
    const token = createSessionToken(7, secret, 1_000);
    const header = `other=x; ${SESSION_COOKIE}=${token}; last=y`;
    expect(readSession(header, secret, 2_000)).toMatchObject({ sub: 7, iat: 1_000 });
  });

  it("returns null when the cookie is absent", () => {
    expect(readSession("other=x", secret)).toBeNull();
    expect(readSession(undefined, secret)).toBeNull();
  });

  it("returns null once the token has expired", () => {
    const token = createSessionToken(7, secret, 1_000);
    expect(readSession(`${SESSION_COOKIE}=${token}`, secret, 1_000 + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("returns null when the secret has rotated", () => {
    const token = createSessionToken(7, secret, 1_000);
    expect(readSession(`${SESSION_COOKIE}=${token}`, "rotated", 2_000)).toBeNull();
  });

  it("also reads the session cookie that plain-http pages get", () => {
    const token = createSessionToken(42, "secret", 1_000);
    expect(readSession(`${PLAIN_SESSION_COOKIE}=${token}`, "secret", 2_000)?.sub).toBe(42);
  });

  it("reads site tokens only from the site cookies, and admin tokens never from them", () => {
    const site = createSiteSessionToken(7, secret, 1_000);
    const admin = createSessionToken(7, secret, 1_000);
    expect(readSiteSession(`a=b; ${SITE_SESSION_COOKIE}=${site}`, secret, 2_000)).toMatchObject({
      sub: 7,
      aud: "site",
    });
    expect(readSiteSession(`${PLAIN_SITE_SESSION_COOKIE}=${site}`, secret, 2_000)?.sub).toBe(7);
    expect(readSiteSession(`${SESSION_COOKIE}=${site}`, secret, 2_000)).toBeNull();
    expect(readSiteSession(`${PLAIN_SITE_SESSION_COOKIE}=${admin}`, secret, 2_000)).toBeNull();
    expect(readSiteSession(`${PLAIN_SITE_SESSION_COOKIE}=${site}`, secret, 1_000 + SESSION_TTL_MS + 1)).toBeNull();
    expect(readSession(`${SESSION_COOKIE}=${site}`, secret, 2_000)).toBeNull();
    expect(readSession(`${PLAIN_SESSION_COOKIE}=${site}`, secret, 2_000)).toBeNull();
  });

  it("finds a valid session among several values of one name, wherever it stands", () => {
    const site = createSiteSessionToken(7, secret, 1_000);
    const admin = createSessionToken(7, secret, 1_000);
    for (const header of [
      `${SITE_SESSION_COOKIE}=${site}; ${SITE_SESSION_COOKIE}=junk`,
      `x=1; ${SITE_SESSION_COOKIE}=junk; ${SITE_SESSION_COOKIE}=${site}`,
    ]) {
      expect(readSiteSession(header, secret, 2_000)?.sub, header).toBe(7);
    }
    expect(readSession(`${PLAIN_SESSION_COOKIE}=${admin}; ${PLAIN_SESSION_COOKIE}=junk`, secret, 2_000)?.sub).toBe(7);
  });
});
