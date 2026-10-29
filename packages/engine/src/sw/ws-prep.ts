import type { CookieService } from "./cookies/jar.ts";

export interface WsPrep {
  /** The target as this worker parsed it; the server seals for this form, not for the page's raw string. */
  url: string;
  cookie: string | null;
  origin: string;
}

/**
 * The cookies and Origin the upstream handshake needs. The jar is keyed on http(s), so the ws target is mapped
 * before lookup; the Origin is the page's real site, falling back to the target when the page is unknown.
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
