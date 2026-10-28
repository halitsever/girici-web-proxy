import { pickRandom } from "@/lib/random";

export interface InternetFact {
  text: string;
  source: string;
}

const internetFacts: [InternetFact, ...InternetFact[]] = [
  {
    text: "Tim Berners-Lee proposed the World Wide Web at CERN in March 1989.",
    source: "https://www.w3.org/History/1989/proposal.html",
  },
  {
    text: "The first website ever made, info.cern.ch, is still online.",
    source: "https://info.cern.ch/",
  },
  {
    text: "On 30 April 1993, CERN put the World Wide Web software in the public domain.",
    source: "https://home.cern/30-years-free-and-open-web",
  },
  {
    text: 'The first message sent over ARPANET in 1969 was meant to be "login". The system crashed after "lo".',
    source: "https://en.wikipedia.org/wiki/ARPANET",
  },
  {
    text: "The Domain Name System was first specified in 1983 to replace a single shared list of every host on the network.",
    source: "https://www.rfc-editor.org/rfc/rfc882",
  },
];

export function getRandomInternetFact(): InternetFact {
  return pickRandom(internetFacts);
}
