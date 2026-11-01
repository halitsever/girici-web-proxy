import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TTL_MS,
  issueChallenge,
  issueVisitor,
  leadingZeroBits,
  meetsDifficulty,
  powKey,
  readChallenge,
  readVisitor,
  SpentChallenges,
  VISITOR_TTL_MS,
} from "../src/pow/tokens.ts";

const key = powKey("s".repeat(64));

describe("proof-of-work tokens", () => {
  it("counts leading zero bits", () => {
    expect(leadingZeroBits(Uint8Array.of(0, 0, 0x80))).toBe(16);
    expect(leadingZeroBits(Uint8Array.of(0x0f))).toBe(4);
    expect(leadingZeroBits(Uint8Array.of(0, 0, 0))).toBe(24);
    expect(leadingZeroBits(Uint8Array.of(0xff))).toBe(0);
  });

  it("issues a challenge only its own client can answer, until it expires", () => {
    const token = issueChallenge(key, "203.0.113.5", 4, 1_000_000);
    expect(readChallenge(key, token, "203.0.113.5", 1_000_000 + CHALLENGE_TTL_MS - 1)).toMatchObject({ difficulty: 4 });
    expect(readChallenge(key, token, "203.0.113.6", 1_000_000)).toBeNull();
    expect(readChallenge(key, token, "203.0.113.5", 1_000_000 + CHALLENGE_TTL_MS + 1)).toBeNull();
    expect(readChallenge(powKey("t".repeat(64)), token, "203.0.113.5", 1_000_000)).toBeNull();
    const forged = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    expect(readChallenge(key, forged, "203.0.113.5", 1_000_000)).toBeNull();
    expect(token).not.toContain("203.0.113");
  });

  it("accepts a nonce whose hash starts with enough zero bits", () => {
    const token = issueChallenge(key, "c", 8, 0);
    let nonce = 0;
    while (!meetsDifficulty(token, String(nonce), 8)) nonce++;
    expect(leadingZeroBits(createHash("sha256").update(`${token}:${nonce}`).digest())).toBeGreaterThanOrEqual(8);
    for (const bad of ["", "01", "-1", "1.5", "9".repeat(17), "x"]) {
      expect(meetsDifficulty(token, bad, 0), bad).toBe(false);
    }
  });

  it("never takes a challenge for a visitor cookie or the reverse", () => {
    const challenge = issueChallenge(key, "c", 4, 0);
    const visitor = issueVisitor(key, "c", 0);
    expect(readVisitor(key, challenge, "c", 0)).toBeNull();
    expect(readChallenge(key, visitor, "c", 0)).toBeNull();
  });

  it("issues a visitor cookie bound to its client for a day", () => {
    const visitor = issueVisitor(key, "c", 0);
    expect(readVisitor(key, visitor, "c", VISITOR_TTL_MS - 1)).toEqual({ iat: 0 });
    expect(readVisitor(key, visitor, "d", 0)).toBeNull();
    expect(readVisitor(key, visitor, "c", VISITOR_TTL_MS + 1)).toBeNull();
  });

  it("spends each challenge once and forgets it once expired", () => {
    const spent = new SpentChallenges(2);
    expect(spent.spend("a", 100, 0)).toBe(true);
    expect(spent.spend("a", 100, 0)).toBe(false);
    expect(spent.spend("b", 100, 0)).toBe(true);
    expect(spent.spend("c", 100, 0)).toBe(false);
    expect(spent.spend("c", 300, 101)).toBe(true);
    expect(spent.size).toBe(1);
  });
});
