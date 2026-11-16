/**
 * Subdomain mode gives each proxied site its own host, `<label>.<site domain>`, so the browser's origin boundary
 * keeps sites apart. The server, the service worker and the page runtime all name hosts through this one module,
 * which runs beside page code and so reads strings only through natives taken at load.
 */

import { codePointAt, endsWith, indexOf, lowerCase, sliceOf } from "./primordials.ts";
import { hmacSha256, utf8Bytes } from "./seal-cipher.ts";

/** 130 bits of base32, short enough that a 226-character site domain still fits a 253-character host. */
export const SITE_LABEL_LENGTH = 26;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const LABEL_INFO = "girici/v1 site\0";
const MAX_DOMAIN_LENGTH = 253 - SITE_LABEL_LENGTH - 1;
const MAX_DNS_LABEL = 63;

/** The configured site domain; `value` is what a Host header for the root carries. */
export interface SiteDomain {
  host: string;
  port: string;
  value: string;
}

export type HostKind = { kind: "root" } | { kind: "site"; label: string } | { kind: "other" };

/** `site` is a schemeful site such as `https://example.com`; see `labelSiteOf`. */
export function siteLabel(key: Uint8Array, site: string): string {
  const mac = hmacSha256(key, utf8Bytes(LABEL_INFO + site));
  let label = "";
  let bits = 0;
  let held = 0;
  for (let index = 0; label.length < SITE_LABEL_LENGTH;) {
    if (held < 5) {
      bits = (bits << 8) | (mac[index++] as number);
      held += 8;
    }
    held -= 5;
    label += BASE32[(bits >> held) & 31] as string;
    bits &= (1 << held) - 1;
  }
  return label;
}

export function isSiteLabel(text: string): boolean {
  if (typeof text !== "string" || text.length !== SITE_LABEL_LENGTH) return false;
  for (let index = 0; index < SITE_LABEL_LENGTH; index++) {
    const point = codePointAt(text, index) as number;
    if (!isLower(point) && (point < 0x32 || point > 0x37)) return false;
  }
  return true;
}

/** Null unless `raw` is an ASCII DNS name of two or more labels, with an optional port, as a Host header carries it. */
export function parseSiteDomain(raw: string): SiteDomain | null {
  if (typeof raw !== "string") return null;
  const colon = indexOf(raw, ":");
  const host = colon < 0 ? raw : sliceOf(raw, 0, colon);
  const port = colon < 0 ? "" : sliceOf(raw, colon + 1);
  if (colon >= 0 && !isPort(port)) return null;
  if (host.length > MAX_DOMAIN_LENGTH || !isDnsName(host)) return null;
  // Checked as ASCII first, so lowercasing cannot turn another character into a letter.
  const lower = lowerCase(host);
  return { host: lower, port, value: port ? `${lower}:${port}` : lower };
}

/** Reads the raw Host header; a site host is exactly one label in front of the site domain. */
export function classifySiteHost(host: string | undefined, domain: SiteDomain): HostKind {
  if (typeof host !== "string" || host === "") return { kind: "other" };
  const text = lowerCase(host);
  if (text === domain.value) return { kind: "root" };
  const suffix = "." + domain.value;
  if (text.length !== SITE_LABEL_LENGTH + suffix.length || !endsWith(text, suffix)) return { kind: "other" };
  const label = sliceOf(text, 0, SITE_LABEL_LENGTH);
  return isSiteLabel(label) ? { kind: "site", label } : { kind: "other" };
}

export function siteHostOrigin(protocol: string, label: string, domain: SiteDomain): string {
  return `${protocol}//${label}.${domain.value}`;
}

function isDnsName(host: string): boolean {
  let labels = 0;
  let start = 0;
  let last = 0;
  for (let index = 0; index <= host.length; index++) {
    if (index < host.length && codePointAt(host, index) !== 0x2e) continue;
    if (!isDnsLabel(host, start, index)) return false;
    labels++;
    last = start;
    start = index + 1;
  }
  // A numeric last label makes the URL parser read the host as an IPv4 address.
  return labels >= 2 && !isNumber(sliceOf(host, last));
}

function isDnsLabel(host: string, start: number, end: number): boolean {
  const length = end - start;
  if (length < 1 || length > MAX_DNS_LABEL) return false;
  for (let index = start; index < end; index++) {
    const point = codePointAt(host, index) as number;
    const hyphen = point === 0x2d;
    if (hyphen && (index === start || index === end - 1)) return false;
    if (!hyphen && !isLower(point) && !isUpper(point) && !isDigit(point)) return false;
  }
  return true;
}

/** The URL standard's "ends in a number": decimal digits, or 0x followed by hex digits. */
function isNumber(label: string): boolean {
  const hex =
    label.length >= 2 && codePointAt(label, 0) === 0x30 && ((codePointAt(label, 1) as number) | 0x20) === 0x78;
  for (let index = hex ? 2 : 0; index < label.length; index++) {
    const point = codePointAt(label, index) as number;
    if (!isDigit(point) && !(hex && isHexLetter(point))) return false;
  }
  return true;
}

function isPort(text: string): boolean {
  if (text.length < 1 || text.length > 5 || codePointAt(text, 0) === 0x30) return false;
  let port = 0;
  for (let index = 0; index < text.length; index++) {
    const point = codePointAt(text, index) as number;
    if (!isDigit(point)) return false;
    port = port * 10 + point - 0x30;
  }
  return port <= 65535;
}

const isLower = (point: number): boolean => point >= 0x61 && point <= 0x7a;
const isUpper = (point: number): boolean => point >= 0x41 && point <= 0x5a;
const isDigit = (point: number): boolean => point >= 0x30 && point <= 0x39;
const isHexLetter = (point: number): boolean => (point | 0x20) >= 0x61 && (point | 0x20) <= 0x66;
