export type LogLevel = "error" | "warn" | "info" | "debug";

export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
  sourceUrl: string;
}

export const DEFAULT_SOURCE_URL = "https://github.com/halitsever/girici-web-proxy";

const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

type Env = Record<string, string | undefined>;

/** Validates settings up front so a bad value stops startup with the variable's name. */
export function loadConfig(env: Env): Config {
  return {
    port: readPort(env),
    host: env.HOST?.trim() || "0.0.0.0",
    logLevel: readLogLevel(env.LOG_LEVEL),
    sourceUrl: readSourceUrl(env.SOURCE_URL),
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
