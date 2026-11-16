import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici نشانی‌های شبکه محلی یا خصوصی را باز نمی‌کند.",
    dns: "Girici نتوانست \u2068{host}\u2069 را پیدا کند.",
    connect: "Girici نتوانست به \u2068{host}\u2069 وصل شود.",
    tls: "\u2068{host}\u2069 گواهی نامعتبری فرستاد.",
    timeout: "\u2068{host}\u2069 خیلی دیر پاسخ داد.",
    too_large: "درخواست بیش از حد بزرگ است.",
    bad_request: "این نشانی از طریق Girici باز نمی‌شود.",
    header_overflow: "\u2068{host}\u2069 سرآیندهایی بیش از حد بزرگ فرستاد.",
    auth: "برای باز کردن \u2068{host}\u2069 ابتدا باید در Girici وارد شوید.",
    rate_limited: "درخواست‌های زیادی از شبکه شما رسیده است. کمی صبر کنید و سپس صفحه را دوباره بارگذاری کنید.",
    blocked: "\u2068{host}\u2069 روی این سرور Girici مسدود شده است.",
    proxy: "پروکسی بالادستی Girici نتوانست به \u2068{host}\u2069 دسترسی پیدا کند.",
    quota: "شبکه شما سهمیه داده خود را روی این سرور Girici تمام کرده است. {wait} دوباره تلاش کنید.",
    challenge: "Girici باید پیش از باز کردن \u2068{host}\u2069 این مرورگر را بررسی کند. صفحه را دوباره بارگذاری کنید.",
    runtime:
      "Girici نتوانست اسکریپت صفحه خود را تأیید کند. اگر یک CDN یا پروکسی در جلوی این سرور JavaScript را بازنویسی یا فشرده می‌کند، آن را برای /_g/ خاموش کنید.",
    sealed:
      "این نشانی در مرورگر دیگری رمزگذاری شده یا کلید نشانی این مرورگر بازنشانی شده است. سایت را دوباره از Girici باز کنید.",
  },
  someSite: "سایت",
  backHome: "بازگشت به Girici",
  waitLater: "بعداً",
  waitMinute: "یک دقیقه دیگر",
  waitMinutes: { one: "{count} دقیقه دیگر", other: "{count} دقیقه دیگر" },
  waitHours: { one: "{count} ساعت دیگر", other: "{count} ساعت دیگر" },
  warningTitle: "این صفحه از طریق Girici باز می‌شود",
  warningBody:
    "Girici یک پروکسی وب است. صفحه بعدی از \u2068{host}\u2069 می‌آید، نه از گردانندگان این سرور. در سایتی که قصد بازدیدش را نداشتید گذرواژه وارد نکنید.",
  warningContinue: "ادامه به \u2068{host}\u2069",
  warningHome: "رفتن به صفحه اصلی Girici",
};
