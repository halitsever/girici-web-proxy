import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Este navegador não consegue executar o Girici aqui. Service workers precisam de HTTPS ou localhost.",
  noControl: "O Girici não conseguiu assumir o controle desta aba. Recarregue para tentar novamente.",
  failed: "Não foi possível iniciar o Girici: {error}",
};
