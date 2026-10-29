import type { CookieService } from "./cookies/jar.ts";

export interface WsPrep {
  cookie: string | null;
  origin: string;
}

/**
 * Give the WebSocket shim the cookies and Origin the upstream handshake needs.
 * The jar is keyed on http(s), so the ws target is mapped before lookup; the Origin
 * is the page's real site, falling back to the target when the page is unknown.
 */
export async function buildWsPrep(
  cookies: Pick<CookieService, "header">,
  rawUrl: string,
  pageUrl: URL | null,
  allowCookies: (target: URL) => boolean | Promise<boolean> = () => true,
): Promise<WsPrep | null> {
  const ws = URL.parse(rawUrl);
  if (!ws || (ws.protocol !== "ws:" && ws.protocol !== "wss:")) return null;
  const target = new URL(ws.href);
  target.protocol = ws.protocol === "wss:" ? "https:" : "http:";
  if (!(await allowCookies(target))) return { cookie: null, origin: pageUrl?.origin ?? target.origin };
  const cookie = await cookies.header(target, {
    initiator: pageUrl,
    credentials: "include",
    topLevel: false,
    method: "GET",
  });
  return { cookie, origin: pageUrl?.origin ?? target.origin };
}
