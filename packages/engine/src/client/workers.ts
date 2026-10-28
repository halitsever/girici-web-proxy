import { encodeUrl } from "../shared/codec.ts";
import type { Realm, UrlContext } from "./url-context.ts";

declare const __GIRICI_WORKER__: string;

/** Workers load through a bootstrap that installs the worker runtime first, so their code stays inside the proxy. */
export function installWorkers(win: Realm, ctx: UrlContext): void {
  // A blank frame's own location is about:blank, whose origin is "null"; the runtime lives on our origin.
  const runtimeUrl = ctx.origin + __GIRICI_WORKER__;
  for (const name of ["Worker", "SharedWorker"] as const) wrap(win, name, ctx, runtimeUrl);
}

function wrap(win: Realm, name: "Worker" | "SharedWorker", ctx: UrlContext, runtimeUrl: string): void {
  const globals = win as unknown as Record<
    string,
    (new (url: string | URL, options?: WorkerOptions) => object) | undefined
  >;
  const Native = globals[name];
  if (!Native) return;
  globals[name] = new Proxy(Native, {
    construct: (target, args: [string | URL, WorkerOptions?]) =>
      Reflect.construct(target, [bootstrap(win, ctx, runtimeUrl, String(args[0]), args[1]), args[1]]),
  });
}

/** Returns a blob URL whose script loads the worker runtime, then the real script, under the real base. */
function bootstrap(
  win: Realm,
  ctx: UrlContext,
  runtimeUrl: string,
  rawUrl: string,
  options: WorkerOptions | undefined,
): string {
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
  const b = JSON.stringify(base);
  const code =
    options?.type === "module"
      ? `self.__giriciBase=${b};await import(${JSON.stringify(runtimeUrl)});await import(${JSON.stringify(scriptUrl)});`
      : `self.__giriciBase=${b};importScripts(${JSON.stringify(runtimeUrl)},${JSON.stringify(scriptUrl)});`;
  return win.URL.createObjectURL(new win.Blob([code], { type: "text/javascript" }));
}
