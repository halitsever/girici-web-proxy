import { PROTOCOL_VERSION, type SiteSummary } from "../shared/protocol.ts";
import { siteOf, type CookieService } from "./cookies/jar.ts";
import { isUiWindow, realUrlOf, type ClientShape } from "./route.ts";

/** Who called, taken from the calling client rather than the body, so a page cannot claim more than it is. */
export type SiteDataCaller = { kind: "ui" } | { kind: "page"; url: URL } | { kind: "other" };

/** The Girici UI may manage every site, a proxied window only its own, anything else nothing. */
export function callerOf(client: ClientShape | undefined, origin: string): SiteDataCaller {
  if (!client) return { kind: "other" };
  if (isUiWindow(client, origin)) return { kind: "ui" };
  const real = client.type === "window" ? realUrlOf(client.url, origin) : null;
  return real ? { kind: "page", url: real } : { kind: "other" };
}

/** Lists and clears site cookies; the window that called clears that site's storage partitions itself. */
export async function handleSiteData(
  request: Request,
  caller: SiteDataCaller,
  cookies: CookieService,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return status(400);
  }
  if (typeof body !== "object" || body === null) return status(400);
  const { v, op, site, origins } = body as Record<string, unknown>;
  if (v !== PROTOCOL_VERSION) return status(409);
  if (caller.kind === "other") return status(403);
  if (op === "clear") {
    // A proxied page may only clear the site it is on, whatever its body asks for.
    if (caller.kind === "page") {
      const own = siteOf(caller.url.hostname);
      return json({ site: own, cookies: await cookies.clearSite(own) });
    }
    const wanted = typeof site === "string" ? site.toLowerCase() : "";
    if (!wanted || siteOf(wanted) !== wanted) return status(400);
    return json({ site: wanted, cookies: await cookies.clearSite(wanted) });
  }
  if (caller.kind !== "ui") return status(403);
  if (op === "clear-all") return json({ cookies: await cookies.clearSite(null) });
  if (op !== "list" || !Array.isArray(origins) || !origins.every((origin) => typeof origin === "string")) {
    return status(400);
  }
  return json({ sites: summarize(await cookies.siteCookieCounts(), origins) });
}

function summarize(counts: Map<string, number>, origins: string[]): SiteSummary[] {
  const sites = new Map<string, SiteSummary>();
  const entry = (site: string): SiteSummary => {
    let summary = sites.get(site);
    if (!summary) {
      summary = { site, cookies: 0, origins: [] };
      sites.set(site, summary);
    }
    return summary;
  };
  for (const [site, count] of counts) entry(site).cookies = count;
  for (const origin of origins) {
    let host: string;
    try {
      host = new URL(origin).hostname;
    } catch {
      continue;
    }
    const summary = entry(siteOf(host));
    if (!summary.origins.includes(origin)) summary.origins.push(origin);
  }
  return [...sites.values()]
    .map((summary) => ({ ...summary, origins: [...summary.origins].sort() }))
    .sort((a, b) => (a.site < b.site ? -1 : a.site > b.site ? 1 : 0));
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
