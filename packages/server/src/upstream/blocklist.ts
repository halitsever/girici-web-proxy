import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export const MAX_BLOCKED_HOSTS = 1000;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** One canonical spelling per entry, so a pasted URL, a wildcard and a unicode name all match the same requests. */
export function normalizeHostEntry(raw: string): string | null {
  const entry = raw.trim();
  if (!entry) return null;
  const url = URL.parse(entry.includes("://") ? entry : `http://${entry}`);
  if (!url) return null;
  // The URL parser already lowercases, punycodes and canonicalizes IP literals.
  let host = url.hostname.replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.$/, "");
  if (host.startsWith("[")) host = host.slice(1, -1);
  if (isIP(host)) return canonicalIp(host);
  return host.split(".").every((label) => LABEL.test(label)) ? host : null;
}

/** An IPv4-mapped IPv6 literal reaches the same host as its IPv4 form, so both must hit the same entry. */
function canonicalIp(address: string): string {
  return ipaddr.process(address).toString();
}

export function parseHostList(raw: string): { hosts: string[]; invalid: string[] } {
  const hosts = new Set<string>();
  const invalid: string[] = [];
  for (const entry of raw.split(/[\s,]+/)) {
    if (!entry) continue;
    const host = normalizeHostEntry(entry);
    if (host) hosts.add(host);
    else invalid.push(entry);
  }
  return { hosts: [...hosts], invalid };
}

/** Operator-blocked hosts from the environment and from Settings; an entry also covers its subdomains. */
export class HostBlocklist {
  readonly #env: string[];
  #stored: string[];
  #all: Set<string>;

  constructor(env: readonly string[], stored: readonly string[]) {
    this.#env = [...env];
    this.#stored = [...stored];
    this.#all = new Set([...env, ...stored]);
  }

  update(stored: readonly string[]): void {
    this.#stored = [...stored];
    this.#all = new Set([...this.#env, ...stored]);
  }

  env(): string[] {
    return [...this.#env];
  }

  stored(): string[] {
    return [...this.#stored];
  }

  /** Takes URL.hostname as is: brackets, trailing dot and case are handled here. */
  isBlocked(hostname: string): boolean {
    let host = hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[")) host = host.slice(1, -1);
    if (isIP(host)) return this.#all.has(canonicalIp(host));
    for (let rest = host; ;) {
      if (this.#all.has(rest)) return true;
      const dot = rest.indexOf(".");
      if (dot === -1) return false;
      rest = rest.slice(dot + 1);
    }
  }
}
