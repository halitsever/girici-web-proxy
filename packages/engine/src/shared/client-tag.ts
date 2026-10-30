import type { ClientConfig } from "./protocol.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;", "'": "&#39;" };

/** The runtime reads its config from this attribute, before any page script can run. */
export function clientTag(src: string, config: ClientConfig): string {
  const value = JSON.stringify(config).replace(/[&"<>']/g, (char) => ESCAPES[char] ?? char);
  return `<script src="${src}" data-girici="${value}"></script>`;
}

/** Takes the runtime tag back out of a srcdoc the page reads, so it sees the markup it wrote. */
export function stripClientTag(markup: string, clientUrl: string): string {
  const open = `<script src="${clientUrl}" data-girici="`;
  const start = markup.indexOf(open);
  if (start < 0) return markup;
  const end = markup.indexOf('"></script>', start + open.length);
  return end < 0 ? markup : markup.slice(0, start) + markup.slice(end + '"></script>'.length);
}
