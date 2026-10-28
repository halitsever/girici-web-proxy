import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.ts";
import { signSession, verifySession } from "../src/auth/session.ts";

describe("password", () => {
  it("verifies the right password and rejects wrong ones", () => {
    const { hash, salt } = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", hash, salt)).toBe(true);
    expect(verifyPassword("wrong", hash, salt)).toBe(false);
    expect(verifyPassword("correct horse battery staple", hash, "deadbeef")).toBe(false);
  });

  it("salts so the same password hashes differently", () => {
    expect(hashPassword("same").hash).not.toBe(hashPassword("same").hash);
  });
});

describe("session", () => {
  const secret = "s3cr3t-session-key";
  const payload = { sub: 1, iat: 1_000, exp: 10_000 };

  it("round-trips a signed session", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, secret, 5_000)).toEqual(payload);
  });

  it("rejects a tampered body or signature", () => {
    const token = signSession(payload, secret);
    const [body, sig] = token.split(".");
    expect(verifySession(`${body}x.${sig}`, secret, 5_000)).toBeNull();
    expect(verifySession(`${body}.${sig}x`, secret, 5_000)).toBeNull();
  });

  it("rejects a wrong secret and an expired token", () => {
    const token = signSession(payload, secret);
    expect(verifySession(token, "other", 5_000)).toBeNull();
    expect(verifySession(token, secret, 20_000)).toBeNull();
  });
});
