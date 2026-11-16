import type { Catalogs } from "@girici/engine/shared";
import { pickRandom } from "@/lib/random";

export interface InternetFact {
  text: Catalogs<string>;
  source: string;
}

const internetFacts: [InternetFact, ...InternetFact[]] = [
  {
    text: {
      en: "Tim Berners-Lee proposed the World Wide Web at CERN in March 1989.",
      tr: "Tim Berners-Lee, World Wide Web'i Mart 1989'da CERN'de önerdi.",
    },
    source: "https://www.w3.org/History/1989/proposal.html",
  },
  {
    text: {
      en: "The first website ever made, info.cern.ch, is still online.",
      tr: "Yapılan ilk web sitesi, info.cern.ch, hâlâ yayında.",
    },
    source: "https://info.cern.ch/",
  },
  {
    text: {
      en: "On 30 April 1993, CERN put the World Wide Web software in the public domain.",
      tr: "CERN, 30 Nisan 1993'te World Wide Web yazılımını kamuya açık hale getirdi.",
    },
    source: "https://home.cern/30-years-free-and-open-web",
  },
  {
    text: {
      en: 'The first message sent over ARPANET in 1969 was meant to be "login". The system crashed after "lo".',
      tr: '1969\'da ARPANET üzerinden gönderilen ilk mesajın "login" olması gerekiyordu. Sistem "lo" harflerinden sonra çöktü.',
    },
    source: "https://en.wikipedia.org/wiki/ARPANET",
  },
  {
    text: {
      en: "The Domain Name System was first specified in 1983 to replace a single shared list of every host on the network.",
      tr: "Alan Adı Sistemi ilk kez 1983'te, ağdaki tüm makineleri tutan tek ve ortak bir listenin yerini almak üzere tanımlandı.",
    },
    source: "https://www.rfc-editor.org/rfc/rfc882",
  },
];

export function getRandomInternetFact(): InternetFact {
  return pickRandom(internetFacts);
}
