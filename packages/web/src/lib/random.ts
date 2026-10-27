/** The non-empty tuple type lets `items[0]` stand in without a non-null assertion. */
export function pickRandom<T>(items: readonly [T, ...T[]]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}
