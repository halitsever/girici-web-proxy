import { encodeUrl } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { hookWorkers, type WorkerGlobals } from "./worker-bootstrap.ts";

declare const __GIRICI_WORKER__: string;

/** Workers load through a bootstrap that installs the worker runtime first, so their code stays inside the proxy. */
export function installWorkers(win: Realm, ctx: UrlContext, partition: () => string): void {
  hookWorkers(win as unknown as WorkerGlobals, {
    // A blank frame's own location is about:blank, whose origin is "null"; the runtime lives on our origin.
    runtimeUrl: ctx.origin + __GIRICI_WORKER__,
    partition,
    blobBase: () => ctx.realUrl().href,
    resolve: (raw) => {
      // A blank frame's address is about:blank, so relative worker URLs resolve against the proxy URL of the page's base.
      const scriptUrl = new URL(ctx.toProxy(raw), new URL(encodeUrl(ctx.realBase()), ctx.origin)).href;
      return { scriptUrl, base: ctx.fromProxy(scriptUrl) };
    },
  });
}
