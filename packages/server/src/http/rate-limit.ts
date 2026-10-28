/** A fixed-window limiter keyed by client; returns false once a key exceeds max in the window. */
export function rateLimiter({ windowMs, max }: { windowMs: number; max: number }): (key: string) => boolean {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now >= entry.reset) {
      // Drop fully expired windows so the map tracks only currently active clients.
      for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}
