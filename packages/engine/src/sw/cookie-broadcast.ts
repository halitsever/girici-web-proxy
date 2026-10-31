import { domainMatches } from "../shared/cookie-mirror.ts";
import type { CookieSnapshot } from "../shared/protocol.ts";
import { realUrlOf } from "./route.ts";

/** Each change reaches only the windows showing the cookie's own site; workers and the UI get nothing. */
export function cookieDeliveries<C extends { type: string; url: string }>(
  clients: ReadonlyArray<C>,
  changes: CookieSnapshot[],
  origin: string,
): Array<{ client: C; changes: CookieSnapshot[] }> {
  const deliveries: Array<{ client: C; changes: CookieSnapshot[] }> = [];
  for (const client of clients) {
    if (client.type !== "window") continue;
    const host = realUrlOf(client.url, origin)?.hostname.toLowerCase();
    if (!host) continue;
    const mine = changes.filter((cookie) =>
      cookie.hostOnly ? host === cookie.domain : domainMatches(host, cookie.domain),
    );
    if (mine.length > 0) deliveries.push({ client, changes: mine });
  }
  return deliveries;
}
