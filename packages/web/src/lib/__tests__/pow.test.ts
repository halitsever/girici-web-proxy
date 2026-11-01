import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fetchChallenge,
  isChallengePath,
  leadingZeroBits,
  passedRecently,
  rememberPass,
  solve,
  submitSolution,
} from "../pow";

function answering(status: number, body: unknown = null): typeof fetch {
  return (async () =>
    body === null ? new Response(null, { status }) : Response.json(body, { status })) as unknown as typeof fetch;
}

describe("proof-of-work solver", () => {
  it("counts leading zero bits", () => {
    expect(leadingZeroBits(Uint8Array.of(0, 0x10))).toBe(11);
    expect(leadingZeroBits(Uint8Array.of(0xff))).toBe(0);
    expect(leadingZeroBits(Uint8Array.of(0, 0))).toBe(16);
  });

  it("finds a nonce the server would accept", () => {
    const nonce = solve("abc.def", 8);
    expect(nonce).toMatch(/^(0|[1-9]\d{0,15})$/);
    const hash = createHash("sha256").update(`abc.def:${nonce}`).digest();
    expect(leadingZeroBits(hash)).toBeGreaterThanOrEqual(8);
    expect(solve("abc.def", 30, 0, 10)).toBeNull();
  });

  it("asks the server for a challenge", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return Response.json({ challenge: "abc.def", difficulty: 4 });
    }) as unknown as typeof fetch;
    await expect(fetchChallenge(fetcher)).resolves.toEqual({ challenge: "abc.def", difficulty: 4 });
    expect(asked).toEqual(["/_g/pow"]);
    await expect(fetchChallenge(answering(429))).rejects.toThrow("Too many checks");
    await expect(fetchChallenge(answering(200, { challenge: 1 }))).rejects.toThrow("Reload the page");
  });

  it("explains a refused answer", async () => {
    const answer = { challenge: "abc.def", nonce: "7" };
    await expect(submitSolution(answer, answering(429))).rejects.toThrow(
      "Too many checks from your network. Wait a minute, then reload.",
    );
    await expect(submitSolution(answer, answering(403))).rejects.toThrow(
      "The check did not go through. Reload the page to try again.",
    );
    await expect(submitSolution(answer, answering(204))).resolves.toBeUndefined();
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

describe("challenge loop guard", () => {
  it("notices a return for the same page within half a minute of a pass", () => {
    const storage = memoryStorage();
    expect(passedRecently(storage, "/~/https/a.test/", 1_000)).toBe(false);
    rememberPass(storage, "/~/https/a.test/", 1_000);
    expect(passedRecently(storage, "/~/https/a.test/", 30_999)).toBe(true);
    expect(passedRecently(storage, "/~/https/b.test/", 2_000)).toBe(false);
    expect(passedRecently(storage, "/~/https/a.test/", 31_000)).toBe(false);
  });

  it("treats storage that fails or holds junk as no pass", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberPass(broken, "/", 0)).not.toThrow();
    expect(passedRecently(broken, "/", 0)).toBe(false);
    const junk = memoryStorage();
    junk.setItem("girici:challenge-pass", "{");
    expect(passedRecently(junk, "/", 0)).toBe(false);
  });

  it("knows the challenge page in any letter case and with a trailing slash", () => {
    for (const path of ["/_g/challenge", "/_g/challenge/", "/_G/Challenge", "/_g/challenge//"]) {
      expect(isChallengePath(path), path).toBe(true);
    }
    for (const path of ["/", "/_g/challenges", "/_g/login"]) expect(isChallengePath(path), path).toBe(false);
  });
});
