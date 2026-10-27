import { encodeUrl } from "../shared/codec.ts";
import { decodeHeaderList, HEADER, type RelayErrorCode } from "../shared/protocol.ts";
import { errorPage } from "./error-page.ts";

export type ResponseKind = "navigation" | "subresource";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
// The browser already decoded the relay body, so the upstream encoding and length no longer apply.
const DROPPED_HEADERS = new Set(["content-encoding", "content-length", "set-cookie"]);

export function buildPageResponse(relay: Response, target: URL, kind: ResponseKind, origin: string): Response {
  const error = relay.headers.get(HEADER.error);
  if (error) return failure(error as RelayErrorCode, relay.status, target, kind);

  const status = Number(relay.headers.get(HEADER.status) ?? relay.status);
  let envelope: Array<[string, string]>;
  try {
    envelope = decodeHeaderList(relay.headers.get(HEADER.headers) ?? "");
  } catch {
    return failure("connect", 502, target, kind);
  }

  if (REDIRECT_STATUSES.has(status)) {
    const location = envelope.find(([name]) => name === "location")?.[1];
    if (location) return redirectTo(location, status, target, kind, origin);
  }
  if (!Number.isInteger(status) || status < 200 || status > 599) return failure("connect", 502, target, kind);

  const headers = new Headers();
  for (const [name, value] of envelope) {
    if (DROPPED_HEADERS.has(name) || name.startsWith("x-girici-")) continue;
    try {
      headers.append(name, value);
    } catch {
      // A value the Headers API rejects would otherwise fail the whole response.
    }
  }
  return new Response(NULL_BODY_STATUSES.has(status) ? null : relay.body, { status, headers });
}

function redirectTo(location: string, status: number, target: URL, kind: ResponseKind, origin: string): Response {
  let resolved: URL;
  try {
    resolved = new URL(location, target);
  } catch {
    return failure("connect", 502, target, kind);
  }
  const web = resolved.protocol === "http:" || resolved.protocol === "https:";
  return Response.redirect(web ? new URL(encodeUrl(resolved), origin).href : resolved.href, status);
}

function failure(code: RelayErrorCode, status: number, target: URL, kind: ResponseKind): Response {
  if (kind === "subresource") return Response.error();
  return new Response(errorPage(code, target), {
    status: status >= 400 && status <= 599 ? status : 502,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
