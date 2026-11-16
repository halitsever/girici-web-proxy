import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici no abre direcciones de redes locales o privadas.",
    dns: "Girici no encontró {host}.",
    connect: "Girici no pudo conectarse a {host}.",
    tls: "{host} envió un certificado no válido.",
    timeout: "{host} tardó demasiado en responder.",
    too_large: "La solicitud es demasiado grande.",
    bad_request: "Esta dirección no se puede abrir con Girici.",
    header_overflow: "{host} envió cabeceras demasiado grandes.",
    auth: "Girici necesita que inicies sesión antes de abrir {host}.",
    rate_limited: "Demasiadas solicitudes desde tu red. Espera un momento y recarga la página.",
    blocked: "{host} está bloqueado en este servidor de Girici.",
    proxy: "El proxy de salida de Girici no pudo llegar a {host}.",
    quota: "Tu red ha agotado su cuota de datos en este servidor de Girici. Inténtalo de nuevo {wait}.",
    challenge: "Girici tiene que comprobar este navegador antes de abrir {host}. Recarga la página.",
    runtime:
      "Girici no pudo verificar el script de su página. Si un CDN o proxy delante de este servidor reescribe o minifica JavaScript, desactívalo para /_g/.",
    sealed:
      "Esta dirección se cifró en otro navegador, o la clave de direcciones de este navegador se restableció. Vuelve a abrir el sitio desde Girici.",
  },
  someSite: "el sitio",
  backHome: "Volver a Girici",
  waitLater: "más tarde",
  waitMinute: "dentro de un minuto",
  waitMinutes: {
    one: "dentro de {count} minuto",
    many: "dentro de {count} minutos",
    other: "dentro de {count} minutos",
  },
  waitHours: { one: "dentro de {count} hora", many: "dentro de {count} horas", other: "dentro de {count} horas" },
  warningTitle: "Esta página se abre a través de Girici",
  warningBody:
    "Girici es un proxy web. La siguiente página viene de {host}, no de quienes gestionan este servidor. No escribas contraseñas en un sitio que no pretendías visitar.",
  warningContinue: "Continuar a {host}",
  warningHome: "Ir a la página de inicio de Girici",
};
