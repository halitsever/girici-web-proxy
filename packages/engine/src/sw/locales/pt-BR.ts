import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "O Girici não abre endereços de redes locais ou privadas.",
    dns: "O Girici não encontrou {host}.",
    connect: "O Girici não conseguiu se conectar a {host}.",
    tls: "{host} enviou um certificado inválido.",
    timeout: "{host} demorou demais para responder.",
    too_large: "A solicitação é grande demais.",
    bad_request: "Este endereço não pode ser aberto pelo Girici.",
    header_overflow: "{host} enviou cabeçalhos grandes demais.",
    auth: "O Girici precisa que você entre antes de abrir {host}.",
    rate_limited: "Muitas solicitações vindas da sua rede. Aguarde um momento e recarregue a página.",
    blocked: "{host} está bloqueado neste servidor do Girici.",
    proxy: "O proxy de saída do Girici não conseguiu acessar {host}.",
    quota: "Sua rede esgotou a cota de dados neste servidor do Girici. Tente novamente {wait}.",
    challenge: "O Girici precisa verificar este navegador antes de abrir {host}. Recarregue a página.",
    runtime:
      "O Girici não conseguiu verificar o script da página. Se um CDN ou proxy na frente deste servidor reescreve ou minifica JavaScript, desative isso para /_g/.",
    sealed:
      "Este endereço foi criptografado em outro navegador, ou a chave de endereços deste navegador foi redefinida. Abra o site de novo pelo Girici.",
  },
  someSite: "o site",
  backHome: "Voltar ao Girici",
  waitLater: "mais tarde",
  waitMinute: "daqui a um minuto",
  waitMinutes: { one: "daqui a {count} minuto", many: "daqui a {count} minutos", other: "daqui a {count} minutos" },
  waitHours: { one: "daqui a {count} hora", many: "daqui a {count} horas", other: "daqui a {count} horas" },
  warningTitle: "Esta página abre pelo Girici",
  warningBody:
    "O Girici é um proxy web. A próxima página vem de {host}, não de quem administra este servidor. Não digite senhas em um site que você não pretendia visitar.",
  warningContinue: "Continuar para {host}",
  warningHome: "Ir para a página inicial do Girici",
};
