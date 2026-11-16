import { hkdfSync } from "node:crypto";
import type { SiteDomain } from "@girici/engine/shared";

/** One key per job, all from the never-rotating site secret, so no signature can stand in for another. */
export interface SiteKeys {
  /** Names site hosts; the worker and the page runtime hold it too. */
  label: Uint8Array;
  /** Signs the settings and visited-sites cookies. */
  cookies: Buffer;
  /** Signs clearing plans. */
  clear: Buffer;
}

/** Everything subdomain mode needs on the server; its absence means single-origin mode. */
export interface SiteSetup {
  domain: SiteDomain;
  keys: SiteKeys;
}

export function deriveSiteKeys(secret: string): SiteKeys {
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", secret, "girici", info, 32));
  return {
    label: new Uint8Array(derive("girici/v1 label")),
    cookies: derive("girici/v1 cookies"),
    clear: derive("girici/v1 clear"),
  };
}
