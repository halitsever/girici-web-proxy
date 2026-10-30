import { encodeUrl } from "../shared/codec.ts";
import { hookConstructor } from "./constructors.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { workerBootstrapCode } from "./worker-bootstrap.ts";

declare const __GIRICI_WORKER__: string;

type WorkerConstructor = new (url: string | URL, options?: WorkerOptions | string) => object;

/** Workers load through a bootstrap that installs the worker runtime first, so their code stays inside the proxy. */
export function installWorkers(win: Realm, ctx: UrlContext, partition: () => string): void {
  // A blank frame's own location is about:blank, whose origin is "null"; the runtime lives on our origin.
  const runtimeUrl = ctx.origin + __GIRICI_WORKER__;
  // Taken now, so page code that replaces them cannot hand the native constructor a script of its own.
  const urls = win.URL;
  const createObjectURL = urls.createObjectURL;
  const Blob = win.Blob;

  /** Returns a blob URL whose script loads the worker runtime, then the real script, under the real base. */
  const bootstrap = (rawUrl: string, options: unknown): string => {
    let scriptUrl: string;
    let base: string;
    if (rawUrl.startsWith("blob:")) {
      // A blob worker has no real URL of its own, so it inherits the page's.
      scriptUrl = rawUrl;
      base = ctx.realUrl().href;
    } else {
      // A blank frame's address is about:blank, so relative worker URLs resolve against the proxy URL of the page's base.
      scriptUrl = new URL(ctx.toProxy(rawUrl), new URL(encodeUrl(ctx.realBase()), ctx.origin)).href;
      base = ctx.fromProxy(scriptUrl);
    }
    const code = workerBootstrapCode({
      runtimeUrl,
      scriptUrl,
      base,
      partition: partition(),
      module: (options as WorkerOptions | null | undefined)?.type === "module",
    });
    return createObjectURL.call(urls, new Blob([code], { type: "text/javascript" }));
  };

  const globals = win as unknown as Record<string, WorkerConstructor | undefined>;
  for (const name of ["Worker", "SharedWorker"]) {
    const Native = globals[name];
    if (!Native) continue;
    globals[name] = hookConstructor(Native, (input) => [bootstrap(String(input[0]), input[1]), ...input.slice(1)]);
  }
}
