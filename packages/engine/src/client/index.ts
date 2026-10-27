import { PROTOCOL_VERSION, type ClientConfig } from "../shared/protocol.ts";
import { install } from "./runtime.ts";

const script = document.currentScript;
const config = readConfig(script?.getAttribute("data-girici") ?? null);
// The tag would otherwise show up in the page's own DOM queries.
script?.remove();
install(window, config);

function readConfig(raw: string | null): ClientConfig {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<ClientConfig> | null;
    if (parsed && typeof parsed.v === "number" && Array.isArray(parsed.cookies)) return parsed as ClientConfig;
  } catch {
    // A missing or broken config leaves the page with an empty cookie mirror.
  }
  return { v: PROTOCOL_VERSION, cookies: [] };
}
