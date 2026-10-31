/** Runs `run` while `target[key]` is a page's replacement, and restores the built-in before anything else runs. */
export function withReplaced<T>(target: object, key: PropertyKey, replacement: PropertyDescriptor, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor;
  Object.defineProperty(target, key, { ...original, ...replacement });
  try {
    return run();
  } finally {
    Object.defineProperty(target, key, original);
  }
}

const NativeUrl = URL;
const nativeExec = RegExp.prototype.exec;

/** A stand-in for the global URL that hides where a URL really points. */
class LyingUrl {
  readonly href: string;
  readonly protocol = "x:";
  readonly origin = "null";
  readonly hash = "";
  constructor(raw: string, base?: string | URL) {
    this.href = new NativeUrl(raw, base).href;
  }
}

/** Built-in replacements that each turn a URL the engine proxies into the raw one, or into no URL at all. */
export const REPLACED_BUILTINS: Array<[string, object, PropertyKey, PropertyDescriptor]> = [
  ["String.prototype.startsWith", String.prototype, "startsWith", { value: () => true }],
  ["String.prototype.slice", String.prototype, "slice", { value: () => "" }],
  ["String.prototype.indexOf", String.prototype, "indexOf", { value: () => -1 }],
  ["String.prototype.replace", String.prototype, "replace", { value: () => "#" }],
  ["RegExp.prototype[Symbol.replace]", RegExp.prototype, Symbol.replace, { value: () => "#" }],
  [
    "RegExp.prototype.exec",
    RegExp.prototype,
    "exec",
    {
      // A global pattern keeps the native, or String.prototype.replace would loop forever.
      value(this: RegExp, input: string) {
        return this.global ? Reflect.apply(nativeExec, this, [input]) : ["javascript:"];
      },
    },
  ],
  ["URL", globalThis, "URL", { value: LyingUrl }],
  ["URL.prototype.protocol", URL.prototype, "protocol", { get: () => "x:" }],
  ["URL.prototype.origin", URL.prototype, "origin", { get: () => "http://proxy.test" }],
];
