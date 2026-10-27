export interface BootState {
  count: number;
  firstAt: number;
}

const WINDOW_MS = 30_000;
const MAX_ATTEMPTS = 3;

/** A tab that keeps landing on the bootstrap page would reload forever, so attempts are rationed per window. */
export function nextBootAttempt(previous: BootState | null, now: number): { allowed: boolean; state: BootState } {
  if (!previous || now - previous.firstAt > WINDOW_MS) return { allowed: true, state: { count: 1, firstAt: now } };
  const state = { count: previous.count + 1, firstAt: previous.firstAt };
  return { allowed: state.count <= MAX_ATTEMPTS, state };
}
