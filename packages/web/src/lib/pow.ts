import { CHALLENGE_PATH, POW_PATH } from "@girici/engine/shared";
import { t } from "./i18n";
import { resolveNext } from "./next";

export { leadingZeroBits, solve } from "./pow-solve";

export interface PowChallenge {
  challenge: string;
  difficulty: number;
}

const PASS_KEY = "girici:challenge-pass";
const LOOP_MS = 30_000;

/** The server answers its paths in any letter case, so a next of /_G/challenge/ is this page too. */
export function isChallengePath(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/, "") === CHALLENGE_PATH;
}

/** Where a passed check goes: a proxy address or site host by leaving the UI, else a Girici page other than this one. */
export function afterCheck(
  next: string,
  siteDomain: string | null,
): { kind: "leave"; url: string } | { kind: "route"; path: string } {
  const target = resolveNext(next, siteDomain);
  if (target.kind === "proxy") return { kind: "leave", url: target.path };
  if (target.kind === "site") return { kind: "leave", url: target.url };
  const own = target.kind === "route" && !isChallengePath(new URL(target.path, "http://girici.invalid").pathname);
  return { kind: "route", path: own ? target.path : "/" };
}

/** sessionStorage, or a stand-in where the browser refuses it, since reading the property alone can throw. */
export function tabStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}

/** Marks a pass for this next, so a cookie the relay does not accept cannot send the tab round in circles. */
export function rememberPass(storage: Pick<Storage, "setItem">, next: string, now = Date.now()): void {
  try {
    storage.setItem(PASS_KEY, JSON.stringify({ next, at: now }));
  } catch {
    // Without storage the loop cannot be noticed, but the check still works.
  }
}

/** True when this tab passed the check for the same next within the last half minute. */
export function passedRecently(storage: Pick<Storage, "getItem">, next: string, now = Date.now()): boolean {
  try {
    const mark = JSON.parse(storage.getItem(PASS_KEY) ?? "null") as { next?: unknown; at?: unknown } | null;
    return mark?.next === next && typeof mark.at === "number" && now >= mark.at && now - mark.at < LOOP_MS;
  } catch {
    return false;
  }
}

export async function fetchChallenge(fetcher: typeof fetch = fetch): Promise<PowChallenge> {
  const res = await fetcher(POW_PATH, { headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 429) throw new Error(t("challenge.tooMany"));
  if (!res.ok) throw new Error(t("challenge.failed"));
  const body = (await res.json().catch(() => null)) as Partial<PowChallenge> | null;
  if (typeof body?.challenge !== "string" || typeof body.difficulty !== "number")
    throw new Error(t("challenge.failed"));
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
  if (res.status === 429) throw new Error(t("challenge.tooMany"));
  if (!res.ok) throw new Error(t("challenge.failed"));
}

/** Off the main thread, so the page keeps painting while the browser works. */
export function solveInWorker({ challenge, difficulty }: PowChallenge): Promise<string> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return Promise.reject(new Error(t("challenge.noWorker")));
  }
  return new Promise<string>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ nonce: string | null }>) => {
      if (event.data.nonce) resolve(event.data.nonce);
      else reject(new Error(t("challenge.failed")));
    };
    worker.onerror = () => reject(new Error(t("challenge.noWorker")));
    worker.postMessage({ challenge, difficulty } satisfies PowChallenge);
  }).finally(() => worker.terminate());
}
