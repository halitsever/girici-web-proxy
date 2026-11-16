import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "لا يستطيع هذا المتصفح تشغيل Girici هنا. يحتاج Service Worker إلى HTTPS أو localhost.",
  noControl: "تعذّر على Girici التحكم في علامة التبويب هذه. أعد تحميل الصفحة للمحاولة مرة أخرى.",
  failed: "تعذّر تشغيل Girici: \u2068{error}\u2069",
};
