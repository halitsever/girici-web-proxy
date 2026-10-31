export type LogoType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

export const MAX_LOGO_BYTES = 262_144;

const TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + magic.length && magic.every((byte, i) => bytes[offset + i] === byte);
}

/** Names the type from the bytes alone; the declared type is never trusted. */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return isSvg(bytes) ? "image/svg+xml" : null;
}

function isSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Browsers decode by the declared encoding, so anything but UTF-8 could show markup this reading never saw.
  if (text.includes("<!ENTITY") || text.includes("\x1b")) return false;
  let rest = text;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith("<?xml")) {
      const end = rest.indexOf("?>");
      if (end < 0) return false;
      const encoding = /\sencoding\s*=\s*["']([^"']*)["']/.exec(rest.slice(0, end))?.[1];
      if (encoding !== undefined && encoding.toLowerCase() !== "utf-8") return false;
      rest = rest.slice(end + 2);
    } else if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end < 0) return false;
      rest = rest.slice(end + 3);
    } else if (/^<!DOCTYPE/i.test(rest)) {
      const end = rest.indexOf(">");
      // An internal subset opens with "[" before the closing ">".
      if (end < 0 || rest.slice(0, end).includes("[")) return false;
      rest = rest.slice(end + 1);
    } else {
      return /^<svg[\s/>]/.test(rest);
    }
  }
}

/** Null means invalid: bad type or base64, a size outside 1..256 KB, or bytes that do not match the type. */
export function readLogoUpload(value: unknown): { bytes: Buffer; type: LogoType } | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, data } = value as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || !TYPES.includes(type) || typeof data !== "string") return null;
  if (data.length === 0 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
  return sniffLogo(bytes) === type ? { bytes, type: type as LogoType } : null;
}
