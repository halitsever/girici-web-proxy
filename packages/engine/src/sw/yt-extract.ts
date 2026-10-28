// Give YouTube's web player direct-URL streams instead of SABR. The WEB /player
// response is SABR-only, which through a proxy plays for only ~60s. A mobile-web
// client returns the same video as direct URLs the WEB base.js still deciphers,
// so we re-ask as that client with a server-minted GVS poToken and splice it in.
import type { Transport } from "./transport.ts";

type JsonObject = Record<string, unknown>;

/** Mints a GVS poToken for a content binding (the viewer's visitorData); null when unavailable. */
export type MintPoToken = (contentBinding: string) => Promise<string | null>;

const SPLICE_CLIENT = { name: "MWEB", id: "2", version: "2.20260101.00.00" };

export function isYtPlayer(target: URL): boolean {
  const host = target.hostname;
  return (host === "youtube.com" || host.endsWith(".youtube.com")) && target.pathname.endsWith("/youtubei/v1/player");
}

function parse(text: string): JsonObject | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}

/** Rebuild the WEB response with a non-SABR client's streamingData; null leaves it untouched. */
export async function spliceDirectStreams(
  origBodyBytes: ArrayBuffer,
  webText: string,
  request: Request,
  target: URL,
  clientUrl: URL | null,
  cookie: string | null,
  transport: Transport,
  mintPoToken: MintPoToken,
): Promise<string | null> {
  const web = parse(webText);
  if (!web || !web.streamingData) return null;

  const body = parse(new TextDecoder().decode(origBodyBytes));
  if (!body) return null;
  const context = (body.context ?? (body.context = {})) as JsonObject;
  const client = (context.client ?? (context.client = {})) as JsonObject;
  client.clientName = SPLICE_CLIENT.name;
  client.clientVersion = SPLICE_CLIENT.version;

  // The GVS poToken binds to the viewer's visitorData; without it gated videos 403 past the first minute.
  const visitorData = typeof client.visitorData === "string" ? client.visitorData : null;
  const poToken = visitorData ? await mintPoToken(visitorData) : null;
  // The WEB-bound poToken cannot travel with another client, so replace it or drop it.
  if (poToken) body.serviceIntegrityDimensions = { poToken };
  else delete body.serviceIntegrityDimensions;

  const headers = new Headers(request.headers);
  headers.set("x-youtube-client-name", SPLICE_CLIENT.id);
  headers.set("x-youtube-client-version", SPLICE_CLIENT.version);
  const replay = new Request(request.url, {
    method: "POST",
    headers,
    body: new TextEncoder().encode(JSON.stringify(body)),
  });

  const result = await transport.send(replay, { target, clientUrl, isNavigation: false, cookie });
  if (!result.ok || !result.response.body) return null;
  const streaming = parse(await new Response(result.response.body).text())?.streamingData as JsonObject | undefined;
  if (!streaming || !Array.isArray(streaming.adaptiveFormats)) return null;

  delete streaming.serverAbrStreamingUrl;
  // Progressive URLs keep a scrambled n the player never descrambles, so googlevideo 403s them; keep adaptive only.
  delete streaming.formats;
  web.streamingData = streaming;
  return JSON.stringify(web);
}
