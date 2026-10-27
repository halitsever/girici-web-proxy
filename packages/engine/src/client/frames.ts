import type { ClientConfig } from "../shared/protocol.ts";
import type { InheritedContext, Realm, UrlContext } from "./url-context.ts";

/** Same-origin child frames (blank, srcdoc, dynamic) get the runtime the first time the page reaches into them. */
export function installFrames(
  win: Realm,
  ctx: UrlContext,
  config: ClientConfig,
  install: (win: Realm, config: ClientConfig, inherited?: InheritedContext) => void,
): void {
  const proto = win.HTMLIFrameElement?.prototype;
  if (!proto) return;
  for (const name of ["contentWindow", "contentDocument"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    const get = descriptor?.get;
    if (!get) continue;
    Object.defineProperty(proto, name, {
      ...descriptor,
      get(this: HTMLIFrameElement) {
        const value: unknown = get.call(this);
        setup(value);
        return value;
      },
    });
  }

  function setup(value: unknown): void {
    try {
      const frameWin = (value as Document | null)?.defaultView ?? (value as Window | null);
      // A blank or srcdoc frame shares our origin and inherits this page's real base.
      if (frameWin && frameWin !== (win as Window)) {
        install(frameWin as Realm, config, { origin: ctx.origin, base: ctx.realUrl().href });
      }
    } catch {
      // A cross-origin frame throws on access and cannot be reached anyway.
    }
  }
}
