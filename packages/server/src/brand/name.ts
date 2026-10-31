export const MAX_NAME_LENGTH = 40;

// Control and invisible format characters could make one name read as another. The two joiners stay, since Persian
// words and emoji sequences need them.
const FORBIDDEN = /[\p{Cc}\u2028\u2029]|(?![\u200C\u200D])\p{Cf}/u;

/** Null means invalid. An empty or null value resets to the default name. */
export function readBrandName(value: unknown): { name: string | null } | null {
  if (value === null) return { name: null };
  if (typeof value !== "string") return null;
  const name = value.trim().normalize("NFC");
  if (name === "") return { name: null };
  if ([...name].length > MAX_NAME_LENGTH || FORBIDDEN.test(name)) return null;
  return { name };
}
