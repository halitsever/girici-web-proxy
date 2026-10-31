import { JSDOM } from "jsdom";
import { getChallenge, BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { GOOG_BASE_URL, GOOG_API_KEY, USER_AGENT } from "bgutils-js/utils";
import type { PoSession } from "./potoken.ts";

// YouTube's long-lived web BotGuard key; stable for years.
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const GENERATE_IT = `${GOOG_BASE_URL}/$rpc/google.internal.waa.v1.Waa/GenerateIT`;
// Refresh a minute before the integrity token's real expiry.
const TTL_MARGIN_MS = 60_000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

let domReady = false;

/** BotGuard inspects the environment, so a jsdom window stands in for a browser, once per process. */
function ensureDom(): void {
  if (domReady) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.youtube.com/" });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  if (!(globalThis as { origin?: string }).origin)
    (globalThis as { origin?: string }).origin = "https://www.youtube.com";
  if (!globalThis.navigator)
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  domReady = true;
}

async function interpreterSource(
  challenge: Awaited<ReturnType<typeof getChallenge>>,
  fetchImpl: FetchLike,
): Promise<string> {
  const inline = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (inline) return inline;
  const wrapped = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!wrapped) throw new Error("botguard challenge carried no interpreter");
  const url = "https:" + wrapped.replace(/^https?:/, "");
  return (await fetchImpl(url, { headers: { "user-agent": USER_AGENT } })).text();
}

/**
 * Run the BotGuard attestation once and return a minter bound to its integrity token. Every request goes through
 * fetchImpl, because YouTube ties the tokens to the IP that minted them and the relay must share it.
 */
export async function createBotGuardSession(fetchImpl: FetchLike = fetch): Promise<PoSession> {
  ensureDom();
  const challenge = await getChallenge({
    requestKey: REQUEST_KEY,
    fetchFunction: fetchImpl as typeof fetch,
    useYouTubeAPI: true,
  });
  if (!challenge?.program || !challenge.globalName) throw new Error("botguard challenge incomplete");

  new Function(await interpreterSource(challenge, fetchImpl))();
  const client = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });
  const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
  const botguardResponse = await client.snapshot({ webPoSignalOutput });

  const response = await fetchImpl(GENERATE_IT, {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  const [integrityToken, estimatedTtlSecs] = (await response.json()) as [string?, number?];
  if (!integrityToken) throw new Error(`GenerateIT returned no token (${response.status})`);

  const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs }, webPoSignalOutput);
  const ttlMs = (estimatedTtlSecs ?? 3600) * 1000;
  return {
    expiresAt: Date.now() + Math.max(ttlMs - TTL_MARGIN_MS, 0),
    mint: (contentBinding) => minter.mintAsWebsafeString(contentBinding),
  };
}
