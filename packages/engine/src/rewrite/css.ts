import { rewriteUrl } from "../shared/url-rewrite.ts";

const IMAGE_SET = "image-set(";
const WEBKIT_IMAGE_SET = "-webkit-image-set(";

/** Rewrites url(), @import and image-set() targets; everything else, comments included, keeps its exact text. */
export function rewriteCss(css: string, base: URL, origin: string, opaque = false): string {
  let output = "";
  let copied = 0;
  let index = 0;
  let depth = 0;
  let expectImport = false;
  const imageSets: number[] = [];

  const replace = (start: number, end: number, text: string) => {
    output += css.slice(copied, start) + text;
    copied = end;
  };

  while (index < css.length) {
    const char = css[index];
    if (char === "/" && css[index + 1] === "*") {
      const close = css.indexOf("*/", index + 2);
      index = close < 0 ? css.length : close + 2;
      continue;
    }
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = stringEnd(css, index);
      const closed = end - 1 > index && css[end - 1] === char;
      if (closed && (expectImport || imageSets.length > 0)) {
        const value = unescape(css.slice(index + 1, end - 1));
        const rewritten = rewriteUrl(value, base, origin, undefined, opaque);
        if (rewritten !== value) replace(index, end, quote(rewritten));
      }
      expectImport = false;
      index = end;
      continue;
    }
    // Slicing at every character would make each stylesheet cost several strings per byte.
    if ((char === "u" || char === "U") && startsFunction(css, index, "url(")) {
      const token = readUrl(css, index + 4);
      if (token) {
        const rewritten = rewriteUrl(token.value, base, origin, undefined, opaque);
        if (rewritten !== token.value) replace(index, token.end, `url(${quote(rewritten)})`);
        index = token.end;
      } else {
        index += 4;
      }
      expectImport = false;
      continue;
    }
    if (char === "@" && css.slice(index + 1, index + 7).toLowerCase() === "import" && !isIdentChar(css[index + 7])) {
      expectImport = true;
      index += 7;
      continue;
    }
    const imageSet =
      (char === "i" || char === "I") && startsFunction(css, index, IMAGE_SET)
        ? IMAGE_SET
        : char === "-" && startsFunction(css, index, WEBKIT_IMAGE_SET)
          ? WEBKIT_IMAGE_SET
          : null;
    if (imageSet) {
      imageSets.push(depth);
      depth++;
      index += imageSet.length;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth = Math.max(0, depth - 1);
      if (imageSets.at(-1) === depth) imageSets.pop();
    } else if (char === ";" || char === "{" || char === "}") expectImport = false;
    index++;
  }
  return output + css.slice(copied);
}

/** `name` is lowercase ASCII, and no other character lowercases into one of its letters. */
function startsFunction(css: string, index: number, name: string): boolean {
  for (let offset = 0; offset < name.length; offset++) {
    const code = css.charCodeAt(index + offset);
    if ((code >= 65 && code <= 90 ? code + 32 : code) !== name.charCodeAt(offset)) return false;
  }
  return !isIdentChar(css[index - 1]);
}

/** Returns the index after the closing quote, or where an unterminated string ends. */
function stringEnd(css: string, start: number): number {
  const quoteChar = css[start];
  let index = start + 1;
  while (index < css.length) {
    const char = css[index];
    if (char === "\\") index += 2;
    else if (char === quoteChar) return index + 1;
    else if (char === "\n") return index;
    else index++;
  }
  return css.length;
}

/** Reads the argument of url( up to its closing parenthesis; null when the token is malformed. */
function readUrl(css: string, start: number): { value: string; end: number } | null {
  let index = skipWhitespace(css, start);
  let value: string;
  if (css[index] === '"' || css[index] === "'") {
    const end = stringEnd(css, index);
    if (css[end - 1] !== css[index] || end - 1 === index) return null;
    value = unescape(css.slice(index + 1, end - 1));
    index = skipWhitespace(css, end);
  } else {
    const valueStart = index;
    while (index < css.length && css[index] !== ")" && !isWhitespace(css[index])) {
      index += css[index] === "\\" ? 2 : 1;
    }
    value = unescape(css.slice(valueStart, index));
    index = skipWhitespace(css, index);
  }
  return css[index] === ")" ? { value, end: index + 1 } : null;
}

function unescape(text: string): string {
  return text.replace(
    /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/g,
    (_match, hex, newline, char) => {
      if (newline) return "";
      if (hex) {
        const code = Number.parseInt(hex, 16);
        return code === 0 || code > 0x10ffff ? "�" : String.fromCodePoint(code);
      }
      return char as string;
    },
  );
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

function skipWhitespace(css: string, index: number): number {
  while (index < css.length && isWhitespace(css[index])) index++;
  return index;
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isIdentChar(char: string | undefined): boolean {
  return char !== undefined && (/[\w-]/.test(char) || char.charCodeAt(0) >= 0x80);
}
