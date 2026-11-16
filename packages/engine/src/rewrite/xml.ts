/** Character-level XML helpers for rewriting XHTML and SVG documents in place without breaking well-formedness. */

export interface XmlInstruction {
  start: number;
  end: number;
  target: string;
  /** Where the data after the target starts. */
  dataStart: number;
  data: string;
}

export interface XmlProlog {
  /** Where the root element's start tag begins. */
  root: number;
  instructions: XmlInstruction[];
}

const WHITESPACE = /[\t\n\r ]/;
const NAME_START = /[A-Za-z_:À-￿]/;

/**
 * Finds the root element past the declaration, comments, PIs and doctype. The doctype's internal subset can hold
 * markup that a tag scanner would take for elements. Null when the prolog is not well-formed.
 */
export function scanProlog(text: string): XmlProlog | null {
  const instructions: XmlInstruction[] = [];
  let at = text.startsWith("﻿") ? 1 : 0;
  for (;;) {
    while (at < text.length && WHITESPACE.test(text[at]!)) at++;
    if (text.startsWith("<?", at)) {
      const close = text.indexOf("?>", at + 2);
      if (close < 0) return null;
      const target = /^[^\s?]+/.exec(text.slice(at + 2, close))?.[0] ?? "";
      const dataStart = at + 2 + target.length;
      instructions.push({ start: at, end: close + 2, target, dataStart, data: text.slice(dataStart, close) });
      at = close + 2;
    } else if (text.startsWith("<!--", at)) {
      const close = text.indexOf("-->", at + 4);
      if (close < 0) return null;
      at = close + 3;
    } else if (text.startsWith("<!DOCTYPE", at)) {
      const close = doctypeEnd(text, at + 9);
      if (close < 0) return null;
      at = close + 1;
    } else if (text[at] === "<" && NAME_START.test(text[at + 1] ?? "")) {
      return { root: at, instructions };
    } else {
      return null;
    }
  }
}

/** The index of the `>` that closes a doctype, skipping its quoted strings and internal subset. */
function doctypeEnd(text: string, from: number): number {
  let subset = false;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'") {
      at = text.indexOf(char, at + 1);
      if (at < 0) return -1;
    } else if (subset && text.startsWith("<!--", at)) {
      at = text.indexOf("-->", at + 4);
      if (at < 0) return -1;
      at += 2;
    } else if (subset && text.startsWith("<?", at)) {
      at = text.indexOf("?>", at + 2);
      if (at < 0) return -1;
      at += 1;
    } else if (char === "[") subset = true;
    else if (char === "]") subset = false;
    else if (char === ">" && !subset) return at;
  }
  return -1;
}

export interface PseudoAttribute {
  name: string;
  value: string;
  /** The raw value's range, quotes excluded. */
  start: number;
  end: number;
}

/** The name="value" pairs of a PI such as xml-stylesheet, with ranges offset by `base`. */
export function pseudoAttributes(data: string, base: number): PseudoAttribute[] {
  const found: PseudoAttribute[] = [];
  const pattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(data); match; match = pattern.exec(data)) {
    const raw = match[2] ?? match[3] ?? "";
    const start = base + match.index + match[0].length - 1 - raw.length;
    found.push({ name: match[1]!, value: raw, start, end: start + raw.length });
  }
  return found;
}

const PREDEFINED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const REFERENCE = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g;

/** Only the predefined entities and character references can be decoded without the doctype; null for others. */
export function decodeReferences(raw: string): string | null {
  let unknown = false;
  const decoded = raw.replace(REFERENCE, (match, ref: string) => {
    if (ref[0] !== "#") {
      const char = PREDEFINED[ref];
      if (char === undefined) unknown = true;
      return char ?? match;
    }
    const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      unknown = true;
      return match;
    }
  });
  return unknown || /&(?![^;\s]*;)/.test(raw) ? null : decoded;
}

/** True when the raw attribute source refers to a doctype entity, which a rewrite could not carry over. */
export function hasCustomEntity(raw: string): boolean {
  return decodeReferences(raw) === null;
}

/** The text of a script or style element's raw content, or null when it holds more than text and CDATA. */
export function decodeCharacterData(raw: string): string | null {
  let text = "";
  let at = 0;
  while (at < raw.length) {
    const cdata = raw.indexOf("<![CDATA[", at);
    const plain = raw.slice(at, cdata < 0 ? raw.length : cdata);
    if (plain.includes("<")) return null;
    const decoded = decodeReferences(plain);
    if (decoded === null) return null;
    text += decoded;
    if (cdata < 0) break;
    const close = raw.indexOf("]]>", cdata + 9);
    if (close < 0) return null;
    text += raw.slice(cdata + 9, close);
    at = close + 3;
  }
  return text;
}

/** Escapes element text, `>` included so a `]]>` in rewritten code stays text. */
export function escapeCharacterData(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes a quoted attribute value; whitespace goes as references so attribute normalisation keeps it. */
export function escapeXmlAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}
