import type { ClientConfig } from "../shared/protocol.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "'": "&#39;" };

/** The runtime reads its config from this attribute, before any page script can run. */
export function clientTag(src: string, config: ClientConfig): string {
  const value = JSON.stringify(config).replace(/[&"<>']/g, (char) => ESCAPES[char] ?? char);
  return `<script src="${src}" data-girici="${value}"></script>`;
}
