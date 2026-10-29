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

export type LimitResult = { ok: true } | { ok: false; retryAfter: number };
export type Limiter = ((key: string) => LimitResult) & { size(): number };

interface Bucket {
  tokens: number;
  last: number;
}

/** Refills continuously, so a client that hits the limit is back within seconds instead of a whole window. */
export function tokenBucket({ perMinute, now = Date.now }: { perMinute: number; now?: () => number }): Limiter {
  const perMs = perMinute / 60_000;
  const buckets = new Map<string, Bucket>();
  let lastSweep = now();
  const refilled = (bucket: Bucket, at: number) => Math.min(perMinute, bucket.tokens + (at - bucket.last) * perMs);
  const take = (key: string): LimitResult => {
    const at = now();
    if (at - lastSweep >= 60_000) {
      // A full bucket behaves exactly like a missing one, so dropping it keeps the map to active clients.
      lastSweep = at;
      for (const [k, bucket] of buckets) if (refilled(bucket, at) >= perMinute) buckets.delete(k);
    }
    const bucket = buckets.get(key) ?? { tokens: perMinute, last: at };
    bucket.tokens = refilled(bucket, at);
    bucket.last = at;
    buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
  };
  return Object.assign(take, { size: () => buckets.size });
}
