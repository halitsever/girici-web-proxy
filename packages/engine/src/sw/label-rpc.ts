import { LABEL_RPC_LIMIT, PROTOCOL_VERSION, type LabelAnswer } from "../shared/protocol.ts";

/**
 * Tells a page which host serves each real origin it wants to post a message to. The page runtime has no public
 * suffix list, and the key it would need is no secret, so any page may ask.
 */
export async function handleLabelRpc(
  request: Request,
  hostOf: ((url: URL) => string | null) | null,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body !== "object" || body === null) return new Response(null, { status: 400 });
  const { v, origins } = body as Record<string, unknown>;
  if (v !== PROTOCOL_VERSION || !Array.isArray(origins) || origins.length > LABEL_RPC_LIMIT) {
    return new Response(null, { status: 400 });
  }
  if (!origins.every((origin): origin is string => typeof origin === "string")) {
    return new Response(null, { status: 400 });
  }
  const answer: LabelAnswer = { hosts: origins.map((origin) => [origin, hostFor(origin, hostOf)]) };
  return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
}

function hostFor(origin: string, hostOf: ((url: URL) => string | null) | null): string | null {
  if (!hostOf) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? hostOf(url) : null;
}
