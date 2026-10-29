import { isIP, type LookupFunction, type Socket } from "node:net";
import { rootCertificates } from "node:tls";
import { Agent, buildConnector } from "undici";
import type { UpstreamProxy } from "./proxy-config.ts";
import { createGuardedLookup, resolveGuarded } from "./ssrf.ts";
import { openTunnel } from "./tunnel.ts";

type TestUpstreams = ReadonlyMap<string, { host: string; port: number }>;

export interface UpstreamAgentOptions {
  testUpstreams?: TestUpstreams;
  testCa?: string;
  lookup?: LookupFunction;
  proxy?: UpstreamProxy;
  connectTimeout?: number;
  headersTimeout?: number;
  bodyTimeout?: number;
}

export type TunnelDialer = (hostname: string, port: number) => Promise<Socket>;

/**
 * Vets the target before any tunnel opens. A socks5 proxy gets the vetted address, which leaves no room for DNS
 * rebinding; the other kinds expect a name and resolve it themselves.
 */
export function createTunnelDialer(
  proxy: UpstreamProxy,
  deps: { lookup: LookupFunction; testUpstreams?: TestUpstreams; timeout: number },
): TunnelDialer {
  return async (hostname, port) => {
    const name = hostname.replace(/^\[|\]$/g, "");
    const mapped = deps.testUpstreams?.get(name);
    if (mapped) return openTunnel(proxy, mapped, { timeout: deps.timeout });
    // validateTarget has already refused non-public IP literals.
    if (isIP(name)) return openTunnel(proxy, { host: name, port }, { timeout: deps.timeout });
    const addresses = await resolveGuarded(deps.lookup, name);
    // Most proxies egress over IPv4 only, so a dual-stack name is pinned to its IPv4 address when it has one.
    const pinned = (addresses.find(({ family }) => family === 4) ?? addresses[0])?.address ?? name;
    const host = proxy.protocol === "socks5" ? pinned : name;
    return openTunnel(proxy, { host, port }, { timeout: deps.timeout });
  };
}

export function createUpstreamAgent(options: UpstreamAgentOptions = {}): Agent {
  const lookup = options.lookup ?? createGuardedLookup();
  const timeout = options.connectTimeout ?? 10_000;
  const tls = options.testCa ? { ca: [...rootCertificates, options.testCa] } : {};
  const connector = buildConnector({ lookup, timeout, ...tls });
  const testUpstreams = options.testUpstreams;
  let connect: buildConnector.connector = connector;
  if (options.proxy) {
    const dial = createTunnelDialer(options.proxy, { lookup, testUpstreams, timeout });
    // undici's own connector does the TLS over the tunnel, so ALPN and certificate checks match direct connections.
    const overTunnel = buildConnector({ timeout, ...tls });
    connect = (connectOptions, callback) => {
      const port = Number(connectOptions.port) || (connectOptions.protocol === "https:" ? 443 : 80);
      dial(connectOptions.hostname, port).then(
        (socket) => {
          if (connectOptions.protocol === "https:") overTunnel({ ...connectOptions, httpSocket: socket }, callback);
          else callback(null, socket);
        },
        (error: Error) => callback(error, null),
      );
    };
  } else if (testUpstreams?.size) {
    connect = (connectOptions, callback) => {
      const mapped = testUpstreams.get(connectOptions.hostname);
      // Test mode only: fixture names point at local servers while TLS still checks the original name.
      connector(
        mapped
          ? {
              ...connectOptions,
              hostname: mapped.host,
              port: String(mapped.port),
              servername: connectOptions.hostname,
            }
          : connectOptions,
        callback,
      );
    };
  }
  return new Agent({
    connect,
    headersTimeout: options.headersTimeout ?? 30_000,
    bodyTimeout: options.bodyTimeout ?? 60_000,
    maxHeaderSize: 65_536,
  });
}
