export const MAX_NAME_LENGTH = 40;

// Control characters and the bidi overrides could make one name read as another.
const FORBIDDEN = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/** Null means invalid. An empty or null value resets to the default name. */
export function readBrandName(value: unknown): { name: string | null } | null {
  if (value === null) return { name: null };
  if (typeof value !== "string") return null;
  const name = value.trim().normalize("NFC");
  if (name === "") return { name: null };
  if ([...name].length > MAX_NAME_LENGTH || FORBIDDEN.test(name)) return null;
  return { name };
}
