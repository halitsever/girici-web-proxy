import { normalizeSetupCode } from "./auth/setup-code.ts";
import { compileTrust } from "./http/client-ip.ts";
import { defaultDataDir } from "./paths.ts";
import { parseHostList } from "./upstream/blocklist.ts";
import { parseUpstreamProxy, type UpstreamProxy } from "./upstream/proxy-config.ts";

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
  sourceUrl: string;
  testUpstreams: ReadonlyMap<string, TestUpstream>;
  testCaPath: string | undefined;
  youtubePoToken: boolean;
  dataDir: string;
  trustProxy: boolean | number | string;
  sessionSecret: string | undefined;
  rateLimit: number;
  blockedHosts: string[];
  upstreamProxy: UpstreamProxy | undefined;
  setupToken: string | undefined;
}

export interface TestUpstream {
  host: string;
  port: number;
}

export const DEFAULT_SOURCE_URL = "https://github.com/halitsever/girici-web-proxy";

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

type Env = Record<string, string | undefined>;

/** Validates settings up front so a bad value stops startup with the variable's name. */
export function loadConfig(env: Env): Config {
  // Test mapping is ignored outside NODE_ENV=test, so a stray variable cannot aim traffic at local servers.
  const testMode = env.NODE_ENV === "test";
  return {
    port: readPort(env),
    host: env.HOST?.trim() || "0.0.0.0",
    logLevel: readLogLevel(env.LOG_LEVEL),
    sourceUrl: readSourceUrl(env.SOURCE_URL),
    testUpstreams: testMode ? readTestUpstreams(env.GIRICI_TEST_UPSTREAMS) : new Map(),
    testCaPath: testMode ? env.GIRICI_TEST_CA?.trim() || undefined : undefined,
    youtubePoToken: readBoolean("GIRICI_YT_POTOKEN", env.GIRICI_YT_POTOKEN, true),
    dataDir: env.GIRICI_DATA_DIR?.trim() || defaultDataDir,
    trustProxy: readTrustProxy(env.GIRICI_TRUST_PROXY),
    sessionSecret: readSessionSecret(env.GIRICI_SESSION_SECRET),
    rateLimit: readRateLimit(env.GIRICI_RATE_LIMIT),
    blockedHosts: readBlockedHosts(env.GIRICI_BLOCKED_HOSTS),
    upstreamProxy: parseUpstreamProxy(env.GIRICI_UPSTREAM_PROXY),
    setupToken: readSetupToken(env.GIRICI_SETUP_TOKEN),
  };
}

/** Express trust proxy: a boolean, a hop count, or a preset like "loopback". */
function readTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim();
  if (!value) return false;
  // Digits come first: the docs say "1" for one proxy, and read as true it would trust forged entries.
  if (/^\d+$/.test(value)) return Number(value);
  const lower = value.toLowerCase();
  if (["true", "yes", "on"].includes(lower)) return true;
  if (["false", "no", "off"].includes(lower)) return false;
  try {
    compileTrust(value);
  } catch {
    throw new Error(
      `GIRICI_TRUST_PROXY must be a number of proxies, true/false, or a comma-separated list of addresses, ` +
        `subnets and the names loopback, linklocal or uniquelocal, got "${raw}"`,
    );
  }
  return value;
}

/** Trusting every hop lets any client pick its own rate-limit key, so startup says so. */
export function trustProxyWarning(value: boolean | number | string): string | null {
  if (value !== true) return null;
  return (
    "GIRICI_TRUST_PROXY=true trusts every X-Forwarded-For entry, and clients can forge them. " +
    "Set the number of proxies in front of Girici instead (usually 1)."
  );
}

/** Accepts true/1/yes/on and their negatives; a typo stops startup rather than silently picking the default. */
function readBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true/false, 1/0, yes/no or on/off, got "${raw}"`);
}

/** Counted the way the setup page compares codes, so dashes and spaces cannot pad a weak one. Never echoed. */
function readSetupToken(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (normalizeSetupCode(value).length < 8) {
    throw new Error("GIRICI_SETUP_TOKEN must be at least 8 characters, not counting spaces and dashes");
  }
  return value;
}

/** It signs every admin session, so a short one could be guessed offline. Never echoed. */
function readSessionSecret(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value.length < 32) {
    throw new Error("GIRICI_SESSION_SECRET must be at least 32 characters; openssl rand -hex 32 makes one");
  }
  return value;
}

function readRateLimit(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return 3000;
  if (!/^\d+$/.test(value)) {
    throw new Error(`GIRICI_RATE_LIMIT must be a whole number of requests per minute (0 turns it off), got "${raw}"`);
  }
  return Number(value);
}

function readBlockedHosts(raw: string | undefined): string[] {
  const { hosts, invalid } = parseHostList(raw ?? "");
  if (invalid.length > 0) {
    throw new Error(`GIRICI_BLOCKED_HOSTS has entries that are not host names: ${invalid.join(", ")}`);
  }
  return hosts;
}

function readPort(env: Env): number {
  // LISTENER_PORT is the v1 name; PaaS platforms set PORT.
  for (const name of ["PORT", "LISTENER_PORT"] as const) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const port = Number(raw);
    if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
      throw new Error(`${name} must be an integer between 1 and 65535, got "${raw}"`);
    }
    return port;
  }
  return 3000;
}

function readLogLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim().toLowerCase() || "info";
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (!level) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}, got "${raw}"`);
  }
  return level;
}

function readSourceUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_SOURCE_URL;
  const url = URL.parse(value);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error(`SOURCE_URL must be an http(s) URL, got "${value}"`);
  }
  return value;
}

function readTestUpstreams(raw: string | undefined): Map<string, TestUpstream> {
  const upstreams = new Map<string, TestUpstream>();
  if (!raw?.trim()) return upstreams;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`GIRICI_TEST_UPSTREAMS must be a JSON object, got "${raw}"`);
  }
  for (const [host, target] of Object.entries(parsed)) {
    const [, address, port] = typeof target === "string" ? (/^([0-9.]+):(\d+)$/.exec(target) ?? []) : [];
    if (!address || !port) {
      throw new Error(`GIRICI_TEST_UPSTREAMS entry for ${host} must look like "127.0.0.1:41443"`);
    }
    upstreams.set(host.toLowerCase(), { host: address, port: Number(port) });
  }
  return upstreams;
}
