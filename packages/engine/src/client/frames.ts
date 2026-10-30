import { decodeUrl } from "../shared/codec.ts";
import type { ClientConfig } from "../shared/protocol.ts";
import type { Realm, UrlContext } from "./url-context.ts";

/** Same-origin child frames (blank, srcdoc, dynamic) get the runtime the first time the page reaches into them. */
export function installFrames(
  win: Realm,
  ctx: UrlContext,
  config: ClientConfig,
  clientUrl: string,
  install: (win: Realm, config: ClientConfig, clientUrl: string) => void,
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
        setup(this, value);
        return value;
      },
    });
  }

  function setup(frame: HTMLIFrameElement, value: unknown): void {
    try {
      const frameWin = (value as Document | null)?.defaultView ?? (value as Window | null);
      // A blank or srcdoc frame shares our origin and inherits this page's real base.
      if (frameWin && frameWin !== (win as Window) && !loadsProxiedPage(frame, frameWin)) {
        install(frameWin as Realm, { ...config, inherit: { origin: ctx.origin, base: ctx.realUrl().href } }, clientUrl);
      }
    } catch {
      // A cross-origin frame throws on access and cannot be reached anyway.
    }
  }

  /**
   * A proxied page installs its own runtime. The browser reuses a frame's initial about:blank window for the page it
   * loads next, so installing there first would leave this realm's functions inside that page.
   */
  function loadsProxiedPage(frame: HTMLIFrameElement, frameWin: Window): boolean {
    const href = frameWin.location.href;
    if (href === "about:blank") return !frame.hasAttribute("srcdoc") && /^https?:/i.test(frame.src);
    const url = new URL(href);
    return url.origin === ctx.origin && decodeUrl(url.pathname + url.search) !== null;
  }
}
