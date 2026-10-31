import { readConfig } from "./config.ts";
import { install } from "./runtime.ts";

const script = document.currentScript as HTMLScriptElement | null;
const clientUrl = script?.src ?? "";
const config = readConfig(script?.getAttribute("data-girici") ?? null);
install(window, config, clientUrl);
// The tag would otherwise show up in the page's own DOM queries.
script?.remove();
