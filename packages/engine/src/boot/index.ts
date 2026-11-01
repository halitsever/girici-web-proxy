import { nextBootAttempt, nextStep, REPLAY_FORM_ID, type BootState } from "./attempts.ts";

const STATE_KEY = "girici:boot";
const status = document.getElementById("girici-boot");

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
    show("This browser cannot run Girici here. Service workers need HTTPS or localhost.");
    return;
  }
  const attempt = nextBootAttempt(readState(), Date.now());
  writeState(attempt.state);
  if (!attempt.allowed) {
    show("Girici could not take control of this tab. Reload to try again.");
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
  if (nextStep(document) === "replay") (document.getElementById(REPLAY_FORM_ID) as HTMLFormElement).submit();
  else location.reload();
}

boot().catch((error: unknown) => {
  show(`Girici could not start: ${error instanceof Error ? error.message : String(error)}`);
});
