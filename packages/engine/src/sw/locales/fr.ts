import type { PageText } from "../page-text.ts";

export const pageText: PageText = {
  errors: {
    ssrf_blocked: "Girici n'ouvre pas les adresses de réseaux locaux ou privés.",
    dns: "Girici n'a pas trouvé {host}.",
    connect: "Girici n'a pas pu se connecter à {host}.",
    tls: "{host} a envoyé un certificat invalide.",
    timeout: "{host} a mis trop de temps à répondre.",
    too_large: "La requête est trop volumineuse.",
    bad_request: "Cette adresse ne peut pas être ouverte via Girici.",
    header_overflow: "{host} a envoyé des en-têtes trop volumineux.",
    auth: "Girici vous demande de vous connecter avant d'ouvrir {host}.",
    rate_limited: "Trop de requêtes depuis votre réseau. Patientez un instant, puis rechargez la page.",
    blocked: "{host} est bloqué sur ce serveur Girici.",
    proxy: "Le proxy amont de Girici n'a pas pu joindre {host}.",
    quota: "Votre réseau a épuisé son quota de données sur ce serveur Girici. Réessayez {wait}.",
    challenge: "Girici doit vérifier ce navigateur avant d'ouvrir {host}. Rechargez la page.",
    runtime:
      "Girici n'a pas pu vérifier le script de sa page. Si un CDN ou un proxy placé devant ce serveur réécrit ou minifie le JavaScript, désactivez-le pour /_g/.",
    sealed:
      "Cette adresse a été chiffrée dans un autre navigateur, ou la clé d'adresses de ce navigateur a été réinitialisée. Rouvrez le site depuis Girici.",
  },
  someSite: "le site",
  backHome: "Retour à Girici",
  waitLater: "plus tard",
  waitMinute: "dans une minute",
  waitMinutes: { one: "dans {count} minute", many: "dans {count} minutes", other: "dans {count} minutes" },
  waitHours: { one: "dans {count} heure", many: "dans {count} heures", other: "dans {count} heures" },
  warningTitle: "Cette page s'ouvre via Girici",
  warningBody:
    "Girici est un proxy web. La page suivante provient de {host}, et non des personnes qui gèrent ce serveur. Ne saisissez pas de mot de passe sur un site que vous n'aviez pas l'intention de visiter.",
  warningContinue: "Continuer vers {host}",
  warningHome: "Aller à la page d'accueil de Girici",
};
