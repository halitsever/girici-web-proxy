/** Compares hosts only: behind a TLS terminator the server sees http while the page's Origin says https. */
export function isOwnHost(origin: string | undefined, host: string | undefined): boolean {
  const url = origin ? URL.parse(origin) : null;
  return !!url && (url.protocol === "http:" || url.protocol === "https:") && url.host === host?.toLowerCase();
}
