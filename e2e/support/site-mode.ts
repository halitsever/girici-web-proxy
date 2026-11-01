/** The subdomain-mode servers. Plain Node reads this too (the fixture servers and the trap), so it imports nothing. */

/** Public access on. */
export const SITES = "http://girici.localhost:41005";
/** Public access off, with its own sign-in limiter. */
export const PRIVATE_SITES = "http://private.localhost:41006";
/** Fixed, so every run and every browser sees the same site hosts. */
export const SITE_SECRET = "e2e-site-secret-0123456789abcdef0123";

const SITE_MODE_HOST = /^(?:[a-z2-7]{26}\.)?(girici|private)\.localhost$/;

/** The local port behind a subdomain-mode root or site host, or null for any other host and port. */
export function siteModePort(hostname: string, port: string): number | null {
  const name = SITE_MODE_HOST.exec(hostname.toLowerCase())?.[1];
  const expected = name === "girici" ? 41005 : name === "private" ? 41006 : null;
  return expected !== null && String(expected) === port ? expected : null;
}
