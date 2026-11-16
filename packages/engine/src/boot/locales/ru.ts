import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Этот браузер не может запустить здесь Girici. Service Worker требует HTTPS или localhost.",
  noControl: "Girici не удалось взять эту вкладку под контроль. Обновите страницу, чтобы попробовать снова.",
  failed: "Не удалось запустить Girici: {error}",
};
