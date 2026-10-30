import { PROTOCOL_VERSION, type ClientConfig, type InheritedContext } from "../shared/protocol.ts";

export function readConfig(raw: string | null): ClientConfig {
  // A missing or broken config leaves the page with an empty cookie mirror.
  return parseConfig(raw) ?? { v: PROTOCOL_VERSION, cookies: [] };
}

/** The config as written, or null when it is missing or broken. */
export function parseConfig(raw: string | null): ClientConfig | null {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<ClientConfig> | null;
    if (parsed && typeof parsed.v === "number" && Array.isArray(parsed.cookies)) {
      const config: ClientConfig = { ...parsed, v: parsed.v, cookies: parsed.cookies };
      if (!isInherited(parsed.inherit)) delete config.inherit;
      if (typeof parsed.site !== "string") delete config.site;
      return config;
    }
  } catch {
    // Not JSON.
  }
  return null;
}

function isInherited(value: unknown): value is InheritedContext {
  const candidate = value as Partial<InheritedContext> | null | undefined;
  return typeof candidate?.origin === "string" && typeof candidate.base === "string";
}
