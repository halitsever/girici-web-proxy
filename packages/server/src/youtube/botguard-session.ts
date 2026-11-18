import { JSDOM, VirtualConsole } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { buildURL, getHeaders, parseLooseJSON, USER_AGENT } from "bgutils-js/utils";
import type { PoSession } from "./potoken.ts";

// YouTube's long-lived web BotGuard key; stable for years.
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
// Refresh a minute before the integrity token's real expiry.
const TTL_MARGIN_MS = 60_000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface BgChallenge {
  program: string;
  globalName: string;
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string };
  interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string };
}

export interface PageAttestation {
  config: Record<string, unknown>;
  challenge: BgChallenge;
}

/**
 * The page's ytcfg and the BotGuard challenge it embeds. googlevideo only honours tokens from a challenge issued with
 * a page, attested while yt.config_ (its EVENT_ID) is present.
 */
export function pageAttestation(html: string): PageAttestation | null {
  const config = /ytcfg\.set\(({.+?})\);/s.exec(html)?.[1];
  const initial = /window\.ytAtN\(\s*({[\s\S]*?})\s*\)/.exec(html)?.[1];
  if (!config || !initial) return null;
  try {
    const challenge = (parseLooseJSON(initial) as { R?: { bgChallenge?: BgChallenge } }).R?.bgChallenge;
    if (!challenge?.program || !challenge.globalName) return null;
    return { config: JSON.parse(config) as Record<string, unknown>, challenge };
  } catch {
    return null;
  }
}

/** BotGuard inspects the environment, so a jsdom window stands in for the YouTube page that issued the challenge. */
function installDom(config: Record<string, unknown>): void {
  const dom = new JSDOM('<!doctype html><html lang="en"><head><title></title></head><body></body></html>', {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
    // The page holds no subresources, so this only sets navigator.userAgent to match the requests.
    resources: { userAgent: USER_AGENT },
    // BotGuard probes APIs jsdom lacks, such as canvas, and jsdom would log each probe.
    virtualConsole: new VirtualConsole(),
  });
  const yt = { config_: config };
  Object.assign(dom.window, { yt });
  Object.assign(globalThis, {
    yt,
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });
  // Node has a navigator of its own, which would tell BotGuard it runs in Node.
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
}

async function interpreterSource(challenge: BgChallenge, fetchImpl: FetchLike): Promise<string> {
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
  const page = await fetchImpl("https://www.youtube.com/", {
    headers: { accept: "text/html", "accept-language": "en-US,en;q=0.9", "user-agent": USER_AGENT },
  });
  const attestation = pageAttestation(await page.text());
  if (!attestation) throw new Error(`no botguard challenge on the YouTube page (${page.status})`);
  installDom(attestation.config);

  const { challenge } = attestation;
  new Function(await interpreterSource(challenge, fetchImpl))();
  const client = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });
  const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
  const botguardResponse = await client.snapshot({ webPoSignalOutput });

  const response = await fetchImpl(buildURL("GenerateIT", true), {
    method: "POST",
    headers: getHeaders(),
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
