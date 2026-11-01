import { POW_PATH } from "@girici/engine/shared";

export { leadingZeroBits, solve } from "./pow-solve";

export interface PowChallenge {
  challenge: string;
  difficulty: number;
}

const TOO_MANY = "Too many checks from your network. Wait a minute, then reload.";
const FAILED = "The check did not go through. Reload the page to try again.";
const NO_WORKER = "This browser could not run the check. It needs JavaScript and Web Workers.";

export async function fetchChallenge(fetcher: typeof fetch = fetch): Promise<PowChallenge> {
  const res = await fetcher(POW_PATH, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 429) throw new Error(TOO_MANY);
  if (!res.ok) throw new Error(FAILED);
  const body = (await res.json().catch(() => null)) as Partial<PowChallenge> | null;
  if (typeof body?.challenge !== "string" || typeof body.difficulty !== "number") throw new Error(FAILED);
  return { challenge: body.challenge, difficulty: body.difficulty };
}

export async function submitSolution(
  answer: { challenge: string; nonce: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const res = await fetcher(POW_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answer),
  });
  if (res.status === 429) throw new Error(TOO_MANY);
  if (!res.ok) throw new Error(FAILED);
}

/** Off the main thread, so the page keeps painting while the browser works. */
export function solveInWorker({ challenge, difficulty }: PowChallenge): Promise<string> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.reject(new Error(NO_WORKER));
  }
  return new Promise<string>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ nonce: string | null }>) => {
      if (event.data.nonce) resolve(event.data.nonce);
      else reject(new Error(FAILED));
    };
    worker.onerror = () => reject(new Error(NO_WORKER));
    worker.postMessage({ challenge, difficulty } satisfies PowChallenge);
  }).finally(() => worker.terminate());
}
