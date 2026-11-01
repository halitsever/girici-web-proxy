export interface BootState {
  count: number;
  firstAt: number;
}

const WINDOW_MS = 30_000;
const MAX_ATTEMPTS = 3;
/** The server's replay page holds a form posted to a site host before its worker ran. */
export const REPLAY_FORM_ID = "girici-replay";

/** A kept form goes back through the worker; a reload would turn the post into a GET and lose its fields. */
export function nextStep(doc: { getElementById(id: string): unknown }): "replay" | "reload" {
  return doc.getElementById(REPLAY_FORM_ID) ? "replay" : "reload";
}

/** A field named "submit" shadows the form's own method, so the replay calls the prototype's `submit`. */
export function replayForm(form: object, submit: () => void): void {
  Reflect.apply(submit, form, []);
}

/** A tab that keeps landing on the bootstrap page would reload forever, so attempts are rationed per window. */
export function nextBootAttempt(previous: BootState | null, now: number): { allowed: boolean; state: BootState } {
  if (!previous || now - previous.firstAt > WINDOW_MS) return { allowed: true, state: { count: 1, firstAt: now } };
  const state = { count: previous.count + 1, firstAt: previous.firstAt };
  return { allowed: state.count <= MAX_ATTEMPTS, state };
}
