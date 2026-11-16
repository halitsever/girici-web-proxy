import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "此浏览器无法在这里运行 Girici。Service Worker 需要 HTTPS 或 localhost。",
  noControl: "Girici 无法接管此标签页。请刷新页面重试。",
  failed: "Girici 无法启动：{error}",
};
