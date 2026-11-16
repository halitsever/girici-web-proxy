import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Ce navigateur ne peut pas exécuter Girici ici. Les service workers nécessitent HTTPS ou localhost.",
  noControl: "Girici n'a pas pu prendre le contrôle de cet onglet. Rechargez pour réessayer.",
  failed: "Impossible de démarrer Girici : {error}",
};
