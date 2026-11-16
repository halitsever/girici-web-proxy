import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici öffnet keine lokalen oder privaten Netzwerkadressen.",
    dns: "Girici konnte {host} nicht finden.",
    connect: "Girici konnte {host} nicht erreichen.",
    tls: "{host} hat ein ungültiges Zertifikat gesendet.",
    timeout: "{host} hat zu lange nicht geantwortet.",
    too_large: "Die Anfrage ist zu groß.",
    bad_request: "Diese Adresse lässt sich nicht über Girici öffnen.",
    header_overflow: "{host} hat zu große Header gesendet.",
    auth: "Girici braucht Ihre Anmeldung, bevor es {host} öffnet.",
    rate_limited: "Zu viele Anfragen aus Ihrem Netzwerk. Warten Sie kurz und laden Sie dann neu.",
    blocked: "{host} ist auf diesem Girici-Server gesperrt.",
    proxy: "Der Upstream-Proxy von Girici konnte {host} nicht erreichen.",
    quota:
      "Ihr Netzwerk hat sein Datenkontingent auf diesem Girici-Server aufgebraucht. Versuchen Sie es {wait} erneut.",
    challenge: "Girici muss diesen Browser prüfen, bevor es {host} öffnet. Laden Sie die Seite neu.",
    runtime:
      "Girici konnte sein Seitenskript nicht verifizieren. Wenn ein CDN oder Proxy vor diesem Server JavaScript umschreibt oder minifiziert, schalten Sie das für /_g/ ab.",
    sealed:
      "Diese Adresse wurde in einem anderen Browser verschlüsselt, oder der Adressschlüssel dieses Browsers wurde zurückgesetzt. Öffnen Sie die Website erneut über Girici.",
  },
  someSite: "die Website",
  backHome: "Zurück zu Girici",
  waitLater: "später",
  waitMinute: "in einer Minute",
  waitMinutes: { one: "in {count} Minute", other: "in {count} Minuten" },
  waitHours: { one: "in {count} Stunde", other: "in {count} Stunden" },
  warningTitle: "Diese Seite öffnet sich über Girici",
  warningBody:
    "Girici ist ein Web-Proxy. Die nächste Seite liefert {host}, nicht die Betreiber dieses Servers. Geben Sie keine Passwörter auf einer Website ein, die Sie nicht besuchen wollten.",
  warningContinue: "{host} öffnen",
  warningHome: "Zur Startseite von Girici",
};
