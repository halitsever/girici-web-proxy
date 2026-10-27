import type { LookupFunction } from "node:net";
import { rootCertificates } from "node:tls";
import { Agent, buildConnector } from "undici";
import { createGuardedLookup } from "./ssrf.ts";

export interface UpstreamAgentOptions {
  testUpstreams?: ReadonlyMap<string, { host: string; port: number }>;
  testCa?: string;
  lookup?: LookupFunction;
  connectTimeout?: number;
  headersTimeout?: number;
  bodyTimeout?: number;
}

export function createUpstreamAgent(options: UpstreamAgentOptions = {}): Agent {
  const connector = buildConnector({
    lookup: options.lookup ?? createGuardedLookup(),
    timeout: options.connectTimeout ?? 10_000,
    ...(options.testCa ? { ca: [...rootCertificates, options.testCa] } : {}),
  });
  const testUpstreams = options.testUpstreams;
  const connect: buildConnector.connector = testUpstreams?.size
    ? (connectOptions, callback) => {
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
      }
    : connector;
  return new Agent({
    connect,
    headersTimeout: options.headersTimeout ?? 30_000,
    bodyTimeout: options.bodyTimeout ?? 60_000,
    maxHeaderSize: 65_536,
  });
}
