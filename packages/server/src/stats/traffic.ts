import type { RelayErrorCode } from "@girici/engine/shared";
import type { Direction, RelayKind, RelayObserver } from "../http/relay-observer.ts";

export interface TrafficTotals {
  requests: number;
  sockets: number;
  bytesDown: number;
  bytesUp: number;
  refused: number;
  failed: number;
}

export function emptyTotals(): TrafficTotals {
  return { requests: 0, sockets: 0, bytesDown: 0, bytesUp: 0, refused: 0, failed: 0 };
}

/** A Record, so a new error code fails the typecheck until it is sorted here. */
const OUTCOMES: Record<RelayErrorCode, "refused" | "failed"> = {
  auth: "refused",
  rate_limited: "refused",
  quota: "refused",
  challenge: "refused",
  blocked: "refused",
  too_large: "refused",
  bad_request: "refused",
  ssrf_blocked: "refused",
  dns: "failed",
  connect: "failed",
  tls: "failed",
  timeout: "failed",
  header_overflow: "failed",
  proxy: "failed",
};

export const RELAY_ERROR_CODES = Object.keys(OUTCOMES) as readonly RelayErrorCode[];

export function outcomeClass(code: RelayErrorCode | null): "ok" | "refused" | "failed" {
  return code === null ? "ok" : OUTCOMES[code];
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const MINUTE_MS = 60_000;
const RING_MINUTES = 60;

interface MinuteSlot {
  minute: number;
  totals: TrafficTotals;
}

export interface TrafficCounters {
  /** Keyed "<kind>:<code or ok>". */
  answers: ReadonlyMap<string, number>;
  bytesDown: number;
  bytesUp: number;
  openSockets: number;
  startedAt: number;
}

/** Relay traffic as plain counts: it never keeps a host, path or address. */
export class TrafficStats implements RelayObserver {
  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #ring: Array<MinuteSlot | undefined> = new Array<MinuteSlot | undefined>(RING_MINUTES);
  readonly #answers = new Map<string, number>();
  readonly #unflushed = new Map<string, TrafficTotals>();
  #bytesDown = 0;
  #bytesUp = 0;
  #openSockets = 0;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#startedAt = this.#now();
  }

  bytes(_key: string, count: number, direction: Direction): void {
    if (direction === "down") {
      this.#bytesDown += count;
      this.#add("bytesDown", count);
    } else {
      this.#bytesUp += count;
      this.#add("bytesUp", count);
    }
  }

  answered(kind: RelayKind, code: RelayErrorCode | null): void {
    const key = `${kind}:${code ?? "ok"}`;
    this.#answers.set(key, (this.#answers.get(key) ?? 0) + 1);
    const outcome = outcomeClass(code);
    if (outcome !== "ok") this.#add(outcome, 1);
    else if (kind === "http") this.#add("requests", 1);
    else {
      this.#openSockets++;
      this.#add("sockets", 1);
    }
  }

  socketClosed(): void {
    this.#openSockets = Math.max(0, this.#openSockets - 1);
  }

  /** 60 minutes, oldest first, the current minute last. */
  lastHour(): TrafficTotals[] {
    const current = Math.floor(this.#now() / MINUTE_MS);
    const minutes: TrafficTotals[] = [];
    for (let minute = current - RING_MINUTES + 1; minute <= current; minute++) {
      const slot = this.#ring[minute % RING_MINUTES];
      minutes.push(slot?.minute === minute ? { ...slot.totals } : emptyTotals());
    }
    return minutes;
  }

  counters(): TrafficCounters {
    return {
      answers: new Map(this.#answers),
      bytesDown: this.#bytesDown,
      bytesUp: this.#bytesUp,
      openSockets: this.#openSockets,
      startedAt: this.#startedAt,
    };
  }

  /** What changed since the last call, by UTC day; whatever it returns is never returned again. */
  takeUnflushed(): Array<{ day: string; totals: TrafficTotals }> {
    const days = [...this.#unflushed]
      .filter(([, totals]) => Object.values(totals).some((value) => value !== 0))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, totals]) => ({ day, totals }));
    this.#unflushed.clear();
    return days;
  }

  #add(field: keyof TrafficTotals, count: number): void {
    const now = this.#now();
    const minute = Math.floor(now / MINUTE_MS);
    const index = minute % RING_MINUTES;
    let slot = this.#ring[index];
    if (slot?.minute !== minute) {
      slot = { minute, totals: emptyTotals() };
      this.#ring[index] = slot;
    }
    slot.totals[field] += count;
    const day = utcDay(now);
    let totals = this.#unflushed.get(day);
    if (!totals) {
      totals = emptyTotals();
      this.#unflushed.set(day, totals);
    }
    totals[field] += count;
  }
}
