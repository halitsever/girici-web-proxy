/** A page left over from an older engine reloads once to pick up the matching runtime, never in a loop. */
export function allowVersionReload(storage: Pick<Storage, "getItem" | "setItem">, version: number): boolean {
  const key = `girici:reload:${version}`;
  if (storage.getItem(key)) return false;
  storage.setItem(key, "1");
  return true;
}
