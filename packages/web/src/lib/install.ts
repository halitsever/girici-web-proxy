import { shallowRef } from "vue";

/** Chromium's `beforeinstallprompt` event, which no standard library types. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Set while the browser offers to install the UI. Only Chromium browsers make the offer. */
export const installPrompt = shallowRef<InstallPromptEvent | null>(null);

/** Called before the first await in main.ts, since the browser can make its offer while the page is still loading. */
export function watchInstallPrompt(target: EventTarget): void {
  target.addEventListener("beforeinstallprompt", (event) => {
    installPrompt.value = event as InstallPromptEvent;
  });
  target.addEventListener("appinstalled", () => {
    installPrompt.value = null;
  });
}

/** An event can show its prompt only once, so it is dropped whatever the visitor chooses. */
export async function install(): Promise<boolean> {
  const event = installPrompt.value;
  if (!event) return false;
  installPrompt.value = null;
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}
