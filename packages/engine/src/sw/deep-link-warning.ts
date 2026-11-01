import { CONTINUE_PATH } from "../shared/protocol.ts";
import { fromBase64Url, toBase64Url } from "../shared/seal-cipher.ts";
import type { OpenSealed } from "../shared/sealed-address.ts";
import { errorResponse, forbiddenResponse } from "./error-page.ts";
import type { InstanceState } from "./instance-state.ts";
import type { PrefsService } from "./prefs.ts";
import { realUrlOf } from "./route.ts";
import type { KeyStore } from "./sealing.ts";

/** Not sandboxed like the error pages: a sandbox without allow-forms would block Continue. */
export const WARNING_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const KEY_BYTES = 32;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;

/** The parts of a Request that the Continue handler reads. */
export interface ContinueRequest {
  method: string;
  mode: RequestMode;
  formData(): Promise<FormData>;
}

export interface DeepLinkWarningDeps {
  prefs: Pick<PrefsService, "ready" | "current" | "set">;
  instance: Pick<InstanceState, "deepLinkWarning">;
  keys: KeyStore;
  random?: () => Uint8Array;
}

const randomKey = () => crypto.getRandomValues(new Uint8Array(KEY_BYTES));

/**
 * The notice a visitor sees before a shared proxy link opens. Continue carries a MAC of the address, so a page on
 * another site cannot post the form for the visitor and skip the notice.
 */
export class DeepLinkWarning {
  readonly #prefs: DeepLinkWarningDeps["prefs"];
  readonly #instance: DeepLinkWarningDeps["instance"];
  readonly #keys: KeyStore;
  readonly #random: () => Uint8Array;
  #key: Promise<CryptoKey> | null = null;

  constructor(deps: DeepLinkWarningDeps) {
    this.#prefs = deps.prefs;
    this.#instance = deps.instance;
    this.#keys = deps.keys;
    this.#random = deps.random ?? randomKey;
  }

  async needed(): Promise<boolean> {
    await this.#prefs.ready();
    if (this.#prefs.current().seen) return false;
    return this.#instance.deepLinkWarning();
  }

  async page(to: string, target: URL): Promise<Response> {
    const signature = await crypto.subtle.sign("HMAC", await this.#cryptoKey(), utf8(to));
    const t = toBase64Url(new Uint8Array(signature));
    return new Response(warningPage(to, t, target), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": WARNING_CSP,
        "cross-origin-opener-policy": "same-origin",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  /** A Continue that fails the check still goes back to its address, where the warning shows again. */
  async accept(request: ContinueRequest, open: OpenSealed, origin: string): Promise<Response> {
    if (request.method !== "POST" || request.mode !== "navigate") return forbiddenResponse();
    let to: FormDataEntryValue | null;
    let t: FormDataEntryValue | null;
    try {
      const form = await request.formData();
      to = form.get("to");
      t = form.get("t");
    } catch {
      return errorResponse("bad_request", 400, null);
    }
    const address = typeof to === "string" ? proxyAddress(to, origin, open) : null;
    if (!address || typeof to !== "string") return errorResponse("bad_request", 400, null);
    if (typeof t === "string" && (await this.#verify(to, t))) await this.#prefs.set({ seen: true });
    return Response.redirect(address.href, 303);
  }

  async #verify(to: string, t: string): Promise<boolean> {
    const signature = fromBase64Url(t);
    if (!signature) return false;
    return crypto.subtle.verify("HMAC", await this.#cryptoKey(), new Uint8Array(signature), utf8(to));
  }

  #cryptoKey(): Promise<CryptoKey> {
    this.#key ??= this.#loadKey();
    return this.#key;
  }

  async #loadKey(): Promise<CryptoKey> {
    let raw: Uint8Array;
    try {
      raw = await this.#keys.loadOrCreate(this.#random);
    } catch {
      // A key that lives only as long as this worker still lets the visitor continue from the page it served.
      raw = this.#random();
    }
    return crypto.subtle.importKey("raw", new Uint8Array(raw), HMAC, false, ["sign", "verify"]);
  }
}

/** The address resolved on our origin when it is a proxy address this browser can open, else null. */
function proxyAddress(to: string, origin: string, open: OpenSealed): URL | null {
  let url: URL;
  try {
    url = new URL(to, origin);
  } catch {
    return null;
  }
  return realUrlOf(url.href, origin, open) ? url : null;
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function warningPage(to: string, t: string, target: URL): string {
  const host = escapeHtml(target.host);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Girici</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
      body { margin: 0 auto; max-width: 36rem; padding: 3rem 1rem; }
      code { display: block; overflow-wrap: anywhere; padding: 0.5rem; border: 1px solid; border-radius: 0.25rem; }
      button { font: inherit; padding: 0.5rem 1rem; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>This page opens through Girici</h1>
    <p>Girici is a web proxy. The next page comes from ${host}, not from the people who run this server. Do not type passwords into a site you did not mean to visit.</p>
    <p><code>${escapeHtml(target.href)}</code></p>
    <form method="post" action="${CONTINUE_PATH}">
      <input type="hidden" name="to" value="${escapeHtml(to)}" />
      <input type="hidden" name="t" value="${escapeHtml(t)}" />
      <button type="submit">Continue to ${host}</button>
    </form>
    <p><a href="/">Go to Girici&#39;s home page</a></p>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
