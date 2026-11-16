import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Browser ini tidak dapat menjalankan Girici di sini. Service Worker memerlukan HTTPS atau localhost.",
  noControl: "Girici tidak dapat mengambil alih tab ini. Muat ulang untuk mencoba lagi.",
  failed: "Girici tidak dapat dimulai: {error}",
};
