import { sha256 } from "@girici/engine/shared";

export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte !== 0) return bits + Math.clz32(byte) - 24;
    bits += 8;
  }
  return bits;
}

/**
 * Tries nonces from `from` upward, at most `budget` of them, and returns the first decimal nonce whose
 * SHA-256(challenge + ":" + nonce) starts with `difficulty` zero bits. Kept apart from pow.ts, which starts the worker.
 */
export function solve(
  challenge: string,
  difficulty: number,
  from = 0,
  budget = Number.MAX_SAFE_INTEGER,
): string | null {
  const prefix = new TextEncoder().encode(`${challenge}:`);
  const input = new Uint8Array(prefix.length + 16);
  input.set(prefix);
  const end = Math.min(from + budget, Number.MAX_SAFE_INTEGER);
  for (let nonce = from; nonce < end; nonce++) {
    const digits = String(nonce);
    let length = prefix.length;
    for (let i = 0; i < digits.length; i++) input[length++] = digits.charCodeAt(i);
    if (leadingZeroBits(sha256(input.subarray(0, length))) >= difficulty) return digits;
  }
  return null;
}
