import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  PLAIN_SESSION_COOKIE,
  readSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
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
});
