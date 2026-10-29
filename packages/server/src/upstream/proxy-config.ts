export interface UpstreamProxy {
  protocol: "http" | "https" | "socks5" | "socks5h";
  /** A hostname or IP address; IPv6 without brackets. */
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const DEFAULT_PORTS: Record<UpstreamProxy["protocol"], number> = { http: 80, https: 443, socks5: 1080, socks5h: 1080 };
// The value is never echoed: even a malformed one can hold the credentials, and this lands in startup logs.
const INVALID = "GIRICI_UPSTREAM_PROXY must be an http, https, socks5 or socks5h URL with a host and no path";

/** Reads GIRICI_UPSTREAM_PROXY; blank means no proxy. */
export function parseUpstreamProxy(raw: string | undefined): UpstreamProxy | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const url = URL.parse(value);
  const protocol = url?.protocol.slice(0, -1);
  const bare = url && (url.pathname === "" || url.pathname === "/") && !url.search && !url.hash;
  if (!url || !bare || !url.hostname || !isProtocol(protocol)) throw new Error(INVALID);
  const proxy: UpstreamProxy = {
    protocol,
    host: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
    port: url.port ? Number(url.port) : DEFAULT_PORTS[protocol],
  };
  try {
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
  } catch {
    throw new Error(INVALID);
  }
  return proxy;
}

/** For logs: the credentials never leave this module. */
export function describeProxy(proxy: UpstreamProxy): string {
  const host = proxy.host.includes(":") ? `[${proxy.host}]` : proxy.host;
  return `${proxy.protocol}://${host}:${proxy.port}`;
}

function isProtocol(value: string | undefined): value is UpstreamProxy["protocol"] {
  return value === "http" || value === "https" || value === "socks5" || value === "socks5h";
}
