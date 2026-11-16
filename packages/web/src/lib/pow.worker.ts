import { solve } from "./pow-solve";
import type { PowChallenge } from "./pow";

self.onmessage = (event: MessageEvent<PowChallenge>) => {
  const { challenge, difficulty } = event.data;
  self.postMessage({ nonce: solve(challenge, difficulty) });
};
