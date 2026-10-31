import { PROTOCOL_VERSION, SITE_DATA_RPC_PATH } from "../shared/protocol.ts";
import { captureSiteDataEnv, clearPartitions, type SiteDataEnv } from "../shared/site-data.ts";
import { classifyInput } from "../shared/target.ts";
import { readToolbarPrefs, UI_SETTINGS_KEY } from "../shared/ui-settings.ts";
import { TOOLBAR_CSS, TOOLBAR_HTML } from "./toolbar-view.ts";
import type { Realm, UrlContext } from "./url-context.ts";

export const TOOLBAR_TAG = "girici-bar";

const MAX_REATTACH = 3;
const CONFIRM_TEXT = "Clear cookies and storage for this site?";
const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

export interface ToolbarNatives {
  isTop: boolean;
  storage: Storage | null;
  attachShadow(host: Element): ShadowRoot;
  setShadowHtml(root: ShadowRoot, html: string): void;
  fetch: typeof fetch;
  /** Storage as it was before storage isolation wrapped it, so clearing reaches every partition by name. */
  siteData: SiteDataEnv;
}

export interface ToolbarNavigation {
  assign(path: string): void;
  reload(): void;
}

/** Taken before the other runtime steps wrap these, so the toolbar never goes through the page's rewriting. */
export function captureToolbarNatives(win: Realm): ToolbarNatives {
  let storage: Storage | null = null;
  try {
    storage = win.localStorage;
  } catch {
    // Blocked storage keeps the default choices.
  }
  let isTop = false;
  try {
    isTop = win.top === win;
  } catch {
    // A top we cannot read is not our own page.
  }
  const attachShadow = win.Element.prototype.attachShadow;
  const setInnerHtml = Object.getOwnPropertyDescriptor(win.ShadowRoot.prototype, "innerHTML")?.set;
  return {
    isTop,
    storage,
    attachShadow: (host) => attachShadow.call(host, { mode: "open" }),
    setShadowHtml: (root, html) => setInnerHtml?.call(root, html),
    fetch: win.fetch.bind(win),
    siteData: captureSiteDataEnv(win),
  };
}

export function shouldShowToolbar(input: { isTop: boolean; inherited: boolean; prefs: string | null }): boolean {
  return input.isTop && !input.inherited && readToolbarPrefs(input.prefs).toolbar;
}

/** A small overlay at the bottom-left corner; it never moves the page's own layout. */
export function installToolbar(win: Realm, ctx: UrlContext, natives: ToolbarNatives, nav: ToolbarNavigation): void {
  const doc = win.document;
  const prefs = readToolbarPrefs(natives.storage?.getItem(UI_SETTINGS_KEY) ?? null);
  const host = doc.createElement(TOOLBAR_TAG);
  const root = natives.attachShadow(host);
  natives.setShadowHtml(root, TOOLBAR_HTML);
  try {
    // Adopted sheets sit outside the page's CSS and its style-src rules.
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(TOOLBAR_CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    // Without constructable sheets the toolbar still works, unstyled.
  }
  const handle = root.querySelector<HTMLButtonElement>(".handle");
  const panel = root.querySelector<HTMLElement>(".panel");
  const address = root.querySelector<HTMLInputElement>(".address");
  const confirm = root.querySelector<HTMLElement>(".confirm");
  const message = root.querySelector<HTMLElement>(".message");
  if (!handle || !panel || !address || !confirm || !message) return;

  const expand = () => {
    handle.hidden = true;
    panel.hidden = false;
    address.value = ctx.realUrl().href;
    address.removeAttribute("aria-invalid");
    address.focus();
    address.select();
  };
  const collapse = () => {
    panel.hidden = true;
    confirm.hidden = true;
    handle.hidden = false;
    handle.focus();
  };
  const askToClear = () => {
    panel.hidden = true;
    confirm.hidden = false;
    message.textContent = CONFIRM_TEXT;
    confirm.querySelector<HTMLButtonElement>("button")?.focus();
  };
  const clearSite = async () => {
    message.textContent = "Clearing…";
    try {
      // The service worker picks the site from this page's address, so the body names none.
      const response = await natives.fetch(ctx.origin + SITE_DATA_RPC_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ v: PROTOCOL_VERSION, op: "clear" }),
      });
      const { site } = (await response.json()) as { site?: unknown };
      if (!response.ok || typeof site !== "string") throw new Error("site data RPC failed");
      await clearPartitions(natives.siteData, site);
      nav.reload();
    } catch {
      message.textContent = "Could not clear this site.";
    }
  };
  const submit = () => {
    const resolution = classifyInput(address.value, prefs.engine);
    if (resolution.kind === "url" || resolution.kind === "search") nav.assign(resolution.path);
    else address.setAttribute("aria-invalid", "true");
  };

  handle.addEventListener("click", expand);
  panel.addEventListener("click", (event) => {
    const action = (event.target as Element | null)?.closest("button")?.dataset.action;
    if (action === "home") nav.assign(ctx.origin + "/");
    else if (action === "back") win.history.back();
    else if (action === "forward") win.history.forward();
    else if (action === "reload") nav.reload();
    else if (action === "clear") askToClear();
    else if (action === "hide") collapse();
  });
  confirm.addEventListener("click", (event) => {
    const action = (event.target as Element | null)?.closest("button")?.dataset.action;
    if (action === "confirm-clear") void clearSite();
    else if (action === "cancel-clear") {
      confirm.hidden = true;
      panel.hidden = false;
    }
  });
  address.addEventListener("input", () => address.removeAttribute("aria-invalid"));
  // Registered on window in the capture phase before any page script runs, so no page shortcut sees these keys.
  for (const type of KEY_EVENTS) {
    win.addEventListener(
      type,
      (event) => {
        if (!event.composedPath().includes(host)) return;
        event.stopImmediatePropagation();
        if (event.type !== "keydown") return;
        const { key } = event as KeyboardEvent;
        if (key === "Escape" && handle.hidden) collapse();
        else if (key === "Enter" && event.composedPath()[0] === address) submit();
      },
      true,
    );
  }

  let reattached = 0;
  const start = () => {
    doc.documentElement.appendChild(host);
    // Pages that rebuild their document drop the host; put it back a few times, then stop fighting the page.
    new win.MutationObserver(() => {
      if (host.isConnected || reattached >= MAX_REATTACH) return;
      reattached++;
      doc.documentElement.appendChild(host);
    }).observe(doc.documentElement, { childList: true });
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
