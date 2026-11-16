import { pickLanguage, textFor } from "../shared/i18n/catalog.ts";
import { fill } from "../shared/i18n/text.ts";
import { nextBootAttempt, nextStep, REPLAY_FORM_ID, replayForm, type BootState } from "./attempts.ts";
import { BOOT_TEXT } from "./text.ts";

const STATE_KEY = "girici:boot";
const status = document.getElementById("girici-boot");
// The server wrote the page in the visitor's language, so its lang attribute wins over the browser's list.
const text = textFor(BOOT_TEXT, pickLanguage(BOOT_TEXT, document.documentElement.lang, navigator.languages));

function show(message: string): void {
  if (status) status.textContent = message;
}

function readState(): BootState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as BootState) : null;
  } catch {
    return null;
  }
}

function writeState(state: BootState): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage only costs the loop guard its memory; booting still works.
  }
}

async function boot(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    show(text.noWorker);
    return;
  }
  const attempt = nextBootAttempt(readState(), Date.now());
  writeState(attempt.state);
  if (!attempt.allowed) {
    show(text.noControl);
    return;
  }

  const registration = await navigator.serviceWorker.register("/_g/sw.js", { scope: "/", updateViaCache: "none" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    const claimed = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    registration.active?.postMessage({ type: "girici:claim" });
    await claimed;
  }
  const form = document.getElementById(REPLAY_FORM_ID);
  if (form && nextStep(document) === "replay") replayForm(form, HTMLFormElement.prototype.submit);
  else location.reload();
}

boot().catch((error: unknown) => {
  show(fill(text.failed, { error: error instanceof Error ? error.message : String(error) }));
});
