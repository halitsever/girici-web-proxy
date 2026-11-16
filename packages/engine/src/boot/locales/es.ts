import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Este navegador no puede ejecutar Girici aquí. Los service workers necesitan HTTPS o localhost.",
  noControl: "Girici no pudo tomar el control de esta pestaña. Recarga para intentarlo de nuevo.",
  failed: "No se pudo iniciar Girici: {error}",
};
