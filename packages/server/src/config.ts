export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
  sourceUrl: string;
  testUpstreams: ReadonlyMap<string, TestUpstream>;
  testCaPath: string | undefined;
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
  };
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
