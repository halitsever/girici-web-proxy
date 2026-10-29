const PREFIX = "__g|";

/** The key/name prefix that keeps one real origin's storage apart from another's on our shared origin. */
export function prefixFor(origin: string): string {
  return `${PREFIX}${origin}|`;
}

/** The origin inside a partition name, or null for anything else, such as Girici's own stores. */
export function partitionOrigin(name: string): string | null {
  if (!name.startsWith(PREFIX)) return null;
  const end = name.indexOf("|", PREFIX.length);
  if (end === -1) return null;
  const origin = name.slice(PREFIX.length, end);
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin === origin ? origin : null;
}
