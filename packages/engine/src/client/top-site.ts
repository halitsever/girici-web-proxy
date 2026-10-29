import { decodeUrl } from "../shared/codec.ts";
import { TOP_SITE_QUERY } from "../shared/protocol.ts";
import type { Realm } from "./url-context.ts";

/** The worker cannot see frame ancestry, so a frame answers which page sits on top of it. */
export function installTopSiteResponder(win: Realm): void {
  const container = win.navigator.serviceWorker as ServiceWorkerContainer | undefined;
  if (!container) return;
  container.addEventListener("message", (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type !== TOP_SITE_QUERY) return;
    event.ports[0]?.postMessage({ top: realTopUrl(win) });
  });
  // Messages wait in a queue until this runs, and a frame's first requests are the ones that ask.
  container.startMessages();
}

function realTopUrl(win: Realm): string | null {
  try {
    const top = new URL(win.top?.location.href ?? "");
    return top.origin === win.location.origin ? (decodeUrl(top.pathname + top.search)?.href ?? null) : null;
  } catch {
    // A sandboxed or cross-origin top cannot be read.
    return null;
  }
}
