import type { IncomingMessage } from "node:http";
import ipaddr from "ipaddr.js";
import proxyaddr from "proxy-addr";

export type TrustFn = (address: string, hop: number) => boolean;

/** Express's "trust proxy" meaning, so the WebSocket upgrade path sees the same client as req.ip. */
export function compileTrust(value: boolean | number | string): TrustFn {
  if (value === true) return () => true;
  if (value === false) return () => false;
  if (typeof value === "number") return (_address, hop) => hop < value;
  return proxyaddr.compile(value.split(",").map((entry) => entry.trim()));
}

export function clientIp(req: IncomingMessage, trust: TrustFn): string {
  return proxyaddr(req, trust);
}

/** One IPv6 /64 usually belongs to one subscriber, so rotating addresses inside it must not mint new keys. */
export function clientKey(ip: string): string {
  if (!ipaddr.isValid(ip)) return ip;
  const parsed = ipaddr.process(ip);
  if (parsed.kind() === "ipv4") return parsed.toString();
  const prefix = (parsed as ipaddr.IPv6).parts.slice(0, 4).map((part) => part.toString(16));
  return `${prefix.join(":")}::/64`;
}
