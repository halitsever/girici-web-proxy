import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  PLAIN_SESSION_COOKIE,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "../src/auth/cookie.ts";

const secret = "cookie-secret";

describe("session cookie", () => {
  it("round-trips the admin id through a cookie header", () => {
    const token = createSessionToken(7, secret, 1_000);
    const header = `other=x; ${SESSION_COOKIE}=${token}; last=y`;
    expect(readSessionToken(header, secret, 2_000)).toBe(7);
  });

  it("returns null when the cookie is absent", () => {
    expect(readSessionToken("other=x", secret)).toBeNull();
    expect(readSessionToken(undefined, secret)).toBeNull();
  });

  it("returns null once the token has expired", () => {
    const token = createSessionToken(7, secret, 1_000);
    expect(readSessionToken(`${SESSION_COOKIE}=${token}`, secret, 1_000 + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("returns null when the secret has rotated", () => {
    const token = createSessionToken(7, secret, 1_000);
    expect(readSessionToken(`${SESSION_COOKIE}=${token}`, "rotated", 2_000)).toBeNull();
  });

  it("also reads the session cookie that plain-http pages get", () => {
    const token = createSessionToken(42, "secret", 1_000);
    expect(readSessionToken(`${PLAIN_SESSION_COOKIE}=${token}`, "secret", 2_000)).toBe(42);
  });
});
