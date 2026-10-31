import { ownValue } from "../shared/primordials.ts";
import { TOP_SITE_QUERY } from "../shared/protocol.ts";
import type { DocumentListeners } from "./renewal.ts";
import { realOriginOf, type Realm } from "./url-context.ts";

/** The worker cannot see frame ancestry, so a frame answers which page sits on top of it. */
export function installTopSiteResponder(win: Realm, container: () => ServiceWorkerContainer | null): DocumentListeners {
  const answer = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null || ownValue(data, "type") !== TOP_SITE_QUERY) return;
    // A sealed top's address does not open here, so its own runtime names its origin.
    event.ports[0]?.postMessage({ __proto__: null, top: realTopOrigin(win) });
  };
  const listen = () => {
    const current = container();
    if (!current) return;
    current.addEventListener("message", answer);
    // Messages wait in a queue until this runs, and a frame's first requests are the ones that ask.
    current.startMessages();
  };
  listen();
  return { listen };
}

function realTopOrigin(win: Realm): string | null {
  try {
    return win.top ? realOriginOf(win.top, win.location.origin) : null;
  } catch {
    // A sandboxed or cross-origin top cannot be read.
    return null;
  }
}
