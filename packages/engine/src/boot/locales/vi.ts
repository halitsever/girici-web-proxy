import type { BootText } from "../text.ts";

export const bootText: BootText = {
  noWorker: "Trình duyệt này không thể chạy Girici tại đây. Service worker cần HTTPS hoặc localhost.",
  noControl: "Girici không thể kiểm soát thẻ này. Hãy tải lại trang để thử lại.",
  failed: "Girici không thể khởi động: {error}",
};
