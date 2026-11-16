import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici không mở các địa chỉ mạng cục bộ hoặc mạng riêng.",
    dns: "Girici không tìm thấy {host}.",
    connect: "Girici không thể kết nối đến {host}.",
    tls: "{host} đã gửi một chứng chỉ không hợp lệ.",
    timeout: "{host} phản hồi quá lâu.",
    too_large: "Yêu cầu quá lớn.",
    bad_request: "Không thể mở địa chỉ này qua Girici.",
    header_overflow: "{host} đã gửi header quá lớn.",
    auth: "Bạn cần đăng nhập Girici trước khi mở {host}.",
    rate_limited: "Mạng của bạn đã gửi quá nhiều yêu cầu. Hãy đợi một lát rồi tải lại trang.",
    blocked: "{host} bị chặn trên máy chủ Girici này.",
    proxy: "Proxy upstream của Girici không thể truy cập {host}.",
    quota: "Mạng của bạn đã dùng hết hạn mức dữ liệu trên máy chủ Girici này. Hãy thử lại {wait}.",
    challenge: "Girici cần kiểm tra trình duyệt này trước khi mở {host}. Hãy tải lại trang.",
    runtime:
      "Girici không thể xác minh script của trang. Nếu một CDN hoặc proxy đặt trước máy chủ này viết lại hoặc nén JavaScript, hãy tắt tính năng đó cho /_g/.",
    sealed:
      "Địa chỉ này đã được mã hóa trên một trình duyệt khác, hoặc khóa địa chỉ của trình duyệt này đã bị đặt lại. Hãy mở lại trang web từ Girici.",
  },
  someSite: "trang web",
  backHome: "Quay lại Girici",
  waitLater: "sau",
  waitMinute: "sau một phút",
  waitMinutes: { other: "sau {count} phút" },
  waitHours: { other: "sau {count} giờ" },
  warningTitle: "Trang này được mở qua Girici",
  warningBody:
    "Girici là một proxy web. Trang tiếp theo đến từ {host}, không phải từ những người vận hành máy chủ này. Đừng nhập mật khẩu vào trang web mà bạn không định truy cập.",
  warningContinue: "Tiếp tục đến {host}",
  warningHome: "Đến trang chủ Girici",
};
