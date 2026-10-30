import { domainMatches } from "../shared/cookie-mirror.ts";
import type { CookieSnapshot } from "../shared/protocol.ts";
import { realUrlOf } from "./route.ts";

interface ClientLike {
  id: string;
  type: string;
  url: string;
}

/** Each change reaches only the windows showing the cookie's own site; workers and the UI get nothing. */
export function cookieDeliveries(
  clients: ReadonlyArray<ClientLike>,
  changes: CookieSnapshot[],
  origin: string,
): Array<{ id: string; changes: CookieSnapshot[] }> {
  const deliveries: Array<{ id: string; changes: CookieSnapshot[] }> = [];
  for (const client of clients) {
    if (client.type !== "window") continue;
    const host = realUrlOf(client.url, origin)?.hostname.toLowerCase();
    if (!host) continue;
    const mine = changes.filter((cookie) =>
      cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain),
    );
    if (mine.length > 0) deliveries.push({ id: client.id, changes: mine });
  }
  return deliveries;
}
