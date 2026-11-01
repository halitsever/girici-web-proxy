export type MeterResult = { ok: true } | { ok: false; retryAfter: number; scope: "minute" | "day" };

interface Usage {
  /** Left in the minute bucket; negative once a running response overshot it. */
  tokens: number;
  last: number;
  /** UTC day number that `used` belongs to. */
  day: number;
  used: number;
}

const DAY_MS = 86_400_000;
const SWEEP_MS = 60_000;

const dayOf = (at: number) => Math.floor(at / DAY_MS);

/** Bytes each client moved, against a per-minute bucket and a UTC-day quota. A budget of 0 is off. */
export class ByteMeter {
  readonly #perMinute: number;
  readonly #perDay: number;
  readonly #perMs: number;
  readonly #now: () => number;
  readonly #usage = new Map<string, Usage>();
  #lastSweep: number;

  constructor({ perMinute, perDay, now = Date.now }: { perMinute: number; perDay: number; now?: () => number }) {
    this.#perMinute = perMinute;
    this.#perDay = perDay;
    this.#perMs = perMinute / 60_000;
    this.#now = now;
    this.#lastSweep = now();
  }

  /** Never adds an entry, so refused or idle clients cost no memory. */
  check(key: string): MeterResult {
    const at = this.#now();
    this.#sweep(at);
    const usage = this.#usage.get(key);
    if (!usage) return { ok: true };
    let wait = 0;
    let scope: "minute" | "day" | null = null;
    if (this.#perMinute > 0) {
      const tokens = this.#refilled(usage, at);
      if (tokens <= 0) {
        wait = Math.floor(-tokens / this.#perMs / 1000) + 1;
        scope = "minute";
      }
    }
    const today = dayOf(at);
    if (this.#perDay > 0 && usage.day === today && usage.used >= this.#perDay) {
      const untilMidnight = Math.max(1, Math.ceil(((today + 1) * DAY_MS - at) / 1000));
      if (untilMidnight > wait) {
        wait = untilMidnight;
        scope = "day";
      }
    }
    return scope ? { ok: false, retryAfter: wait, scope } : { ok: true };
  }

  add(key: string, bytes: number): void {
    if (this.#perMinute === 0 && this.#perDay === 0) return;
    const at = this.#now();
    this.#sweep(at);
    const today = dayOf(at);
    let usage = this.#usage.get(key);
    if (!usage) {
      usage = { tokens: this.#perMinute, last: at, day: today, used: 0 };
      this.#usage.set(key, usage);
    }
    if (this.#perMinute > 0) {
      usage.tokens = this.#refilled(usage, at) - bytes;
      usage.last = at;
    }
    if (this.#perDay > 0) {
      if (usage.day !== today) {
        usage.day = today;
        usage.used = 0;
      }
      usage.used += bytes;
    }
  }

  get size(): number {
    return this.#usage.size;
  }

  #refilled(usage: Usage, at: number): number {
    return Math.min(this.#perMinute, usage.tokens + (at - usage.last) * this.#perMs);
  }

  /** A full bucket with nothing counted today behaves like a missing entry, so dropping it changes no answer. */
  #sweep(at: number): void {
    if (at - this.#lastSweep < SWEEP_MS) return;
    this.#lastSweep = at;
    const today = dayOf(at);
    for (const [key, usage] of this.#usage) {
      const full = this.#perMinute === 0 || this.#refilled(usage, at) >= this.#perMinute;
      const counted = this.#perDay > 0 && usage.day === today && usage.used > 0;
      if (full && !counted) this.#usage.delete(key);
    }
  }
}
