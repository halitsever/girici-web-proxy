import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Dieser Browser kann Girici hier nicht ausführen. Service Worker benötigen HTTPS oder localhost.",
  noControl: "Girici konnte diesen Tab nicht übernehmen. Laden Sie neu, um es erneut zu versuchen.",
  failed: "Girici konnte nicht starten: {error}",
};
