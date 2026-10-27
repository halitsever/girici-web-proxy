import { promises as dns } from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";

export const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".test", ".example", ".invalid"];

/** A distinct type lets the relay answer 403 for blocked targets instead of a generic 502. */
export class SsrfBlockedError extends Error {
  readonly code = "GIRICI_SSRF_BLOCKED";
}

export interface TargetPolicy {
  allowedTestHosts: ReadonlySet<string>;
  selfHost?: string;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address);
  const range = parsed.range();
  if (parsed.kind() === "ipv4") return range === "unicast";
  const bytes = parsed.toByteArray();
  // ipaddr calls the deprecated IPv4-compatible block (::/96) unicast, but no public host uses it.
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return false;
  if (range === "unicast") return true;
  // NAT64 and 6to4 addresses carry the IPv4 address the packet is really sent to.
  if (range === "rfc6052") return isPublicAddress(bytes.slice(12, 16).join("."));
  if (range === "6to4") return isPublicAddress(bytes.slice(2, 6).join("."));
  return false;
}

export function validateTarget(url: URL, policy: TargetPolicy): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`Scheme ${url.protocol} is not allowed`);
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new SsrfBlockedError(`Port ${port} is not allowed`);

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (policy.allowedTestHosts.has(hostname)) return;

  const literal = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (ipaddr.isValid(literal)) {
    // Node skips the lookup hook for IP literals, so they are checked here.
    if (!isPublicAddress(literal)) throw new SsrfBlockedError(`Address ${literal} is not public`);
  } else if (isBlockedName(hostname)) {
    throw new SsrfBlockedError(`Host ${hostname} is not public`);
  }
  if (policy.selfHost && hostname === hostWithoutPort(policy.selfHost)) {
    throw new SsrfBlockedError("The proxy cannot open itself");
  }
}

/** Vets every resolved address and hands only those to the socket, so DNS cannot change between check and connect. */
export function createGuardedLookup(
  resolve: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const [first] = addresses;
        if (!first) {
          callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), "", 0);
        } else if (addresses.some(({ address }) => !isPublicAddress(address))) {
          callback(new SsrfBlockedError(`${hostname} resolves to a non-public address`), "", 0);
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0),
    );
  };
}

function isBlockedName(hostname: string): boolean {
  return (
    hostname === "localhost" || !hostname.includes(".") || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function hostWithoutPort(host: string): string {
  const lower = host.toLowerCase();
  if (lower.startsWith("[")) return lower.slice(0, lower.indexOf("]") + 1);
  return lower.split(":")[0] ?? lower;
}
