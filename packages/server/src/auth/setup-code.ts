import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// Crockford base32 leaves out I, L, O and U, so a code read off a log is easy to type back.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A one-time code in the form K7QM-2XPA-9FDR, about 60 bits. */
export function generateSetupCode(): string {
  const symbols = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 4, 8].map((start) => symbols.slice(start, start + 4).join("")).join("-");
}

/** Ignores case, spaces and dashes; digests give timingSafeEqual equal lengths whatever was typed. */
export function setupCodeMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const typed = normalize(given);
  if (!typed) return false;
  return timingSafeEqual(digest(typed), digest(normalize(expected)));
}

/** Printed outside the logger, so LOG_LEVEL cannot hide it; a code from the environment is never echoed. */
export function setupBanner(code: string, fromEnv: boolean): string {
  if (fromEnv) return "Girici is waiting for setup.\nEnter the code from GIRICI_SETUP_TOKEN on the setup page.\n";
  return `Girici setup code: ${code}\nOpen Girici in a browser and enter this code to create the admin account.\n`;
}

function normalize(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
