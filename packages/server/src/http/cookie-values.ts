/**
 * Every value of the named cookies, in header order. A page on any site host can add cookies of the same name for the
 * whole domain, so callers look at each value instead of trusting the first or last.
 */
export function cookieValues(header: string | undefined, names: readonly string[]): string[] {
  const values: string[] = [];
  if (!header) return values;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (names.includes(part.slice(0, eq).trim())) values.push(part.slice(eq + 1).trim());
  }
  return values;
}
