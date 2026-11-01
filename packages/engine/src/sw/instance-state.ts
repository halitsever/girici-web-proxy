import type { PrefsService } from "./prefs.ts";

/** The admin's switches that change what the worker does for every visitor. */
export interface InstanceSwitches {
  sealAddresses: boolean;
  deepLinkWarning: boolean;
}

/** The switches as `/_g/auth/state` tells them, or null when the server cannot say. */
export async function readInstanceState(fetcher: () => Promise<Response>): Promise<InstanceSwitches | null> {
  try {
    const response = await fetcher();
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { sealAddresses, deepLinkWarning } = body as Record<string, unknown>;
    return { sealAddresses: sealAddresses === true, deepLinkWarning: deepLinkWarning === true };
  } catch {
    return null;
  }
}

/** A change the admin makes reaches open tabs within a minute without a UI tab telling the worker. */
const FRESH_MS = 60_000;
const WAIT_MS = 3000;

/** What the server last said about its switches, asked again at most once a minute. */
export class InstanceState {
  readonly #fetchState: () => Promise<Response>;
  readonly #prefs: Pick<PrefsService, "set">;
  readonly #now: () => number;
  #checkedAt = -Infinity;
  #heard: { warning: boolean; at: number } | null = null;
  #pending: Promise<void> | null = null;

  constructor(fetchState: () => Promise<Response>, prefs: Pick<PrefsService, "set">, now: () => number = Date.now) {
    this.#fetchState = fetchState;
    this.#prefs = prefs;
    this.#now = now;
  }

  /** Fire and forget; a failed check keeps what the worker last heard. */
  refresh(force = false): void {
    if (!force && this.#now() - this.#checkedAt < FRESH_MS) return;
    void this.#ask();
  }

  /** Until the server has answered once, a visitor whose link cannot be checked sees the warning. */
  async deepLinkWarning(waitMs = WAIT_MS): Promise<boolean> {
    const heard = this.#heard;
    if (heard && this.#now() - heard.at < FRESH_MS) return heard.warning;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)));
    try {
      await Promise.race([this.#ask(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return this.#heard?.warning ?? true;
  }

  #ask(): Promise<void> {
    this.#checkedAt = this.#now();
    this.#pending ??= this.#read().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #read(): Promise<void> {
    const state = await readInstanceState(this.#fetchState);
    if (!state) return;
    this.#heard = { warning: state.deepLinkWarning, at: this.#now() };
    await this.#prefs.set({ instanceSeal: state.sealAddresses });
  }
}
