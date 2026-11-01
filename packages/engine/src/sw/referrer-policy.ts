/**
 * A site host counts a form post that arrives without a referrer as cross-site. So in subdomain mode a page's choice
 * to send no referrer becomes "same-origin": its referrer then reaches only its own host, which is its own site, and
 * the browser still sends none to any other host.
 */

const HIDDEN = new Set(["no-referrer", "never"]);
const LINKS = new Set(["a", "area", "form"]);

/** A Referrer-Policy value, a list whose last known token wins, or one `<meta name="referrer">` keyword. */
export function sameHostPolicy(policy: string): string {
  return policy
    .split(",")
    .map((token) => (HIDDEN.has(token.trim().toLowerCase()) ? token.replace(token.trim(), "same-origin") : token))
    .join(",");
}

/** The HTML rewriter's last word on an attribute in subdomain mode. */
export function keepSameHostReferrer(
  tag: string,
  attribs: Record<string, string>,
  name: string,
  value: string,
): string {
  const meta = tag === "meta" && name === "content" && attribs.name?.trim().toLowerCase() === "referrer";
  if (meta || name === "referrerpolicy") return sameHostPolicy(value);
  if (name === "rel" && LINKS.has(tag)) return withoutNoreferrer(value);
  return value;
}

/** `noreferrer` also meant `noopener`, which stays. */
function withoutNoreferrer(rel: string): string {
  const tokens = rel.split(/\s+/).filter(Boolean);
  if (!tokens.some((token) => token.toLowerCase() === "noreferrer")) return rel;
  const kept = tokens.filter((token) => token.toLowerCase() !== "noreferrer");
  if (!kept.some((token) => token.toLowerCase() === "noopener")) kept.unshift("noopener");
  return kept.join(" ");
}
