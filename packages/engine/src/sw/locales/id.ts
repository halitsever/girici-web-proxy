import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici tidak membuka alamat jaringan lokal atau privat.",
    dns: "Girici tidak dapat menemukan {host}.",
    connect: "Girici tidak dapat terhubung ke {host}.",
    tls: "{host} mengirim sertifikat yang tidak valid.",
    timeout: "{host} terlalu lama merespons.",
    too_large: "Permintaan terlalu besar.",
    bad_request: "Alamat ini tidak dapat dibuka lewat Girici.",
    header_overflow: "{host} mengirim header yang terlalu besar.",
    auth: "Anda perlu masuk ke Girici sebelum membuka {host}.",
    rate_limited: "Terlalu banyak permintaan dari jaringan Anda. Tunggu sebentar, lalu muat ulang.",
    blocked: "{host} diblokir di server Girici ini.",
    proxy: "Proxy hulu Girici tidak dapat menjangkau {host}.",
    quota: "Jaringan Anda telah menghabiskan kuota data di server Girici ini. Coba lagi {wait}.",
    challenge: "Girici perlu memeriksa browser ini sebelum membuka {host}. Muat ulang halaman.",
    runtime:
      "Girici tidak dapat memverifikasi skrip halamannya. Jika CDN atau proxy di depan server ini mengubah atau meminifikasi JavaScript, nonaktifkan itu untuk /_g/.",
    sealed:
      "Alamat ini dienkripsi di browser lain, atau kunci alamat browser ini telah direset. Buka lagi situsnya dari Girici.",
  },
  someSite: "situs",
  backHome: "Kembali ke Girici",
  waitLater: "nanti",
  waitMinute: "dalam satu menit",
  waitMinutes: { other: "dalam {count} menit" },
  waitHours: { other: "dalam {count} jam" },
  warningTitle: "Halaman ini dibuka lewat Girici",
  warningBody:
    "Girici adalah proxy web. Halaman berikutnya berasal dari {host}, bukan dari pengelola server ini. Jangan ketik kata sandi di situs yang tidak ingin Anda kunjungi.",
  warningContinue: "Lanjutkan ke {host}",
  warningHome: "Ke beranda Girici",
};
