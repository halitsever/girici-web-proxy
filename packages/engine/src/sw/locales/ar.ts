import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "لا يفتح Girici عناوين الشبكات المحلية أو الخاصة.",
    dns: "تعذّر على Girici العثور على \u2068{host}\u2069.",
    connect: "تعذّر على Girici الاتصال بـ \u2068{host}\u2069.",
    tls: "أرسل \u2068{host}\u2069 شهادة غير صالحة.",
    timeout: "استغرق \u2068{host}\u2069 وقتًا طويلًا جدًا للرد.",
    too_large: "الطلب كبير جدًا.",
    bad_request: "لا يمكن فتح هذا العنوان عبر Girici.",
    header_overflow: "أرسل \u2068{host}\u2069 ترويسات كبيرة جدًا.",
    auth: "يجب أن تسجّل الدخول إلى Girici قبل فتح \u2068{host}\u2069.",
    rate_limited: "طلبات كثيرة جدًا من شبكتك. انتظر قليلًا، ثم أعد تحميل الصفحة.",
    blocked: "\u2068{host}\u2069 محظور على خادم Girici هذا.",
    proxy: "تعذّر على البروكسي الوسيط الذي يستخدمه Girici الوصول إلى \u2068{host}\u2069.",
    quota: "استنفدت شبكتك حصة البيانات المسموح بها على خادم Girici هذا. حاول مرة أخرى {wait}.",
    challenge: "يحتاج Girici إلى التحقق من هذا المتصفح قبل فتح \u2068{host}\u2069. أعد تحميل الصفحة.",
    runtime:
      "تعذّر على Girici التحقق من سكربت الصفحة الخاص به. إذا كانت هناك شبكة CDN أو بروكسي أمام هذا الخادم يعيد كتابة JavaScript أو يصغّرها، فأوقف ذلك للمسار /_g/.",
    sealed:
      "تم تشفير هذا العنوان في متصفح آخر، أو أُعيد تعيين مفتاح العناوين في هذا المتصفح. افتح الموقع مرة أخرى من Girici.",
  },
  someSite: "الموقع",
  backHome: "العودة إلى Girici",
  waitLater: "لاحقًا",
  waitMinute: "بعد دقيقة",
  waitMinutes: {
    zero: "بعد {count} دقيقة",
    one: "بعد دقيقة واحدة",
    two: "بعد دقيقتين",
    few: "بعد {count} دقائق",
    many: "بعد {count} دقيقة",
    other: "بعد {count} دقيقة",
  },
  waitHours: {
    zero: "بعد {count} ساعة",
    one: "بعد ساعة واحدة",
    two: "بعد ساعتين",
    few: "بعد {count} ساعات",
    many: "بعد {count} ساعة",
    other: "بعد {count} ساعة",
  },
  warningTitle: "تُفتح هذه الصفحة عبر Girici",
  warningBody:
    "Girici بروكسي ويب. الصفحة التالية تأتي من \u2068{host}\u2069، وليس من القائمين على هذا الخادم. لا تكتب كلمات المرور في موقع لم تكن تقصد زيارته.",
  warningContinue: "المتابعة إلى \u2068{host}\u2069",
  warningHome: "الانتقال إلى الصفحة الرئيسية لـ Girici",
};
