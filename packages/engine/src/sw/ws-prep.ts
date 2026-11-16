import { parseUrl } from "../shared/primordials.ts";
import type { CookieService } from "./cookies/jar.ts";

export interface WsPrep {
  /** The target as this worker parsed it; the server seals for this form, not for the page's raw string. */
  url: string;
  cookie: string | null;
  origin: string;
}

/** The page a socket is opened for, or "anonymous" for a worker no page vouched for. */
export type WsCaller = URL | null | "anonymous";

/** A window's own address, a worker's binding, or "anonymous" for a worker that has none. */
export function wsCaller(
  clientType: string | undefined,
  windowPage: URL | null,
  identity: { page: string } | null,
): WsCaller {
  if (clientType === "window") return windowPage;
  return identity ? new URL(identity.page) : "anonymous";
}

/**
 * The cookies and Origin the upstream handshake needs. The jar is keyed on http(s), so the ws target is mapped
 * before lookup; the Origin is the page's real site, falling back to the target when the page is unknown.
 */
export async function buildWsPrep(
  cookies: Pick<CookieService, "header">,
  rawUrl: string,
  caller: WsCaller,
  allowCookies: (target: URL) => boolean | Promise<boolean> = () => true,
): Promise<WsPrep | null> {
  const ws = parseUrl(rawUrl);
  if (!ws || (ws.protocol !== "ws:" && ws.protocol !== "wss:")) return null;
  // Sent as a third party's socket, since no site vouches for this worker's cookies or Origin.
  if (caller === "anonymous") return { url: ws.href, cookie: null, origin: "null" };
  const pageUrl = caller;
  const target = new URL(ws.href);
  target.protocol = ws.protocol === "wss:" ? "https:" : "http:";
  if (!(await allowCookies(target))) return { url: ws.href, cookie: null, origin: pageUrl?.origin ?? target.origin };
  const cookie = await cookies.header(target, {
    initiator: pageUrl,
    credentials: "include",
    topLevel: false,
    method: "GET",
  });
  return { url: ws.href, cookie, origin: pageUrl?.origin ?? target.origin };
}

/** The server encrypts the prep, so the page relays a cookie it cannot read; null leaves the socket cookie-less. */
export async function sealWsPrep(prep: WsPrep, post: (body: string) => Promise<Response>): Promise<string | null> {
  try {
    const response = await post(JSON.stringify({ url: prep.url, origin: prep.origin, cookie: prep.cookie }));
    if (!response.ok) return null;
    const { seal } = (await response.json()) as { seal?: unknown };
    return typeof seal === "string" ? seal : null;
  } catch {
    return null;
  }
}
