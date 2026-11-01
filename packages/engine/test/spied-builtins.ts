type AnyFunction = (...args: unknown[]) => unknown;

// Taken before any wrapper goes in, so the wrappers themselves never run through one.
const apply = Reflect.apply;
const construct = Reflect.construct;
const ownKeys = Reflect.ownKeys;
const getDescriptor = Reflect.getOwnPropertyDescriptor;
const defineProperty = Reflect.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const includes = String.prototype.includes;
const nativeSplit = String.prototype.split;
const nativeReplace = String.prototype.replace;
const toTag = Object.prototype.toString;
const stringValue = String.prototype.valueOf;
const nativeThen = Promise.prototype.then;
const NativePromise = Promise;
const hrefOf = (getDescriptor(URL.prototype, "href") as PropertyDescriptor).get as AnyFunction;
const decode = TextDecoder.prototype.decode;
const decoder = new TextDecoder();
const nativeAtob = atob;
const nativePush = Array.prototype.push;

const METHODS: Array<[object, string, Array<string | symbol>]> = [
  [
    Array.prototype,
    "Array.prototype",
    [
      "filter",
      "map",
      "sort",
      "join",
      "push",
      "find",
      "findIndex",
      "forEach",
      "some",
      "every",
      "indexOf",
      "includes",
      "slice",
      "concat",
      "reduce",
      "splice",
      "values",
      "at",
      "flat",
      "flatMap",
      Symbol.iterator,
    ],
  ],
  [Array, "Array", ["from", "of", "isArray"]],
  [
    String.prototype,
    "String.prototype",
    [
      "split",
      "slice",
      "substring",
      "trim",
      "indexOf",
      "lastIndexOf",
      "includes",
      "startsWith",
      "endsWith",
      "replace",
      "replaceAll",
      "toLowerCase",
      "charAt",
      "charCodeAt",
      "codePointAt",
      "repeat",
      "match",
      "concat",
      "toString",
      "valueOf",
      Symbol.iterator,
    ],
  ],
  [String, "String", ["fromCharCode"]],
  [RegExp.prototype, "RegExp.prototype", ["exec", "test", Symbol.replace, Symbol.split, Symbol.match]],
  [URL.prototype, "URL.prototype", ["toString", "toJSON"]],
  [Date, "Date", ["parse", "now"]],
  [Number, "Number", ["isNaN", "parseInt"]],
  [JSON, "JSON", ["parse", "stringify"]],
  [Promise, "Promise", ["all", "resolve", "race"]],
  [Promise.prototype, "Promise.prototype", ["then", "catch", "finally"]],
  [Object, "Object", ["keys", "values", "entries", "assign"]],
  [Uint8Array, "Uint8Array", ["from"]],
  [TextDecoder.prototype, "TextDecoder.prototype", ["decode"]],
  [WeakSet.prototype, "WeakSet.prototype", ["has", "add"]],
  [WeakMap.prototype, "WeakMap.prototype", ["get", "set", "has"]],
  [Set.prototype, "Set.prototype", ["has", "add"]],
  [Map.prototype, "Map.prototype", ["get", "set", "has"]],
  [Function.prototype, "Function.prototype", ["call", "apply", "bind"]],
];
const URL_PARTS = ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"];
const GLOBALS = ["atob", "String", "Number", "URL", "TextDecoder", "parseInt"];

/**
 * Runs `run` while this realm's built-ins are a page's wrappers that pass every call on, and returns each value
 * carrying `marker` that reached one of them, as `where: text`. Promises that pass through are watched until they
 * settle, so a value they carry later counts too.
 */
export async function spyBuiltins(marker: string, run: () => unknown): Promise<string[]> {
  const seen: string[] = [];
  let busy = false;
  const note = (where: string, text: string) => {
    apply(nativePush, seen, [`${where}: ${text}`]);
  };
  const scanText = (where: string, text: string) => {
    if (apply(includes, text, [marker])) return note(where, text);
    // The header form of a value is base64url.
    try {
      let base64 = apply(nativeReplace, apply(nativeReplace, text, [/-/g, "+"]), [/_/g, "/"]) as string;
      while (base64.length % 4) base64 += "=";
      const plain = nativeAtob(base64);
      if (apply(includes, plain, [marker])) note(where, `base64 of ${plain}`);
    } catch {
      // Not base64.
    }
  };
  const watch = (where: string, value: unknown) => {
    if (busy) return;
    busy = true;
    try {
      scan(where, value, 0);
    } finally {
      busy = false;
    }
  };
  const scan = (where: string, value: unknown, depth: number): void => {
    if (typeof value === "string") return scanText(where, value);
    // The list itself settles this helper's own promise.
    if (typeof value !== "object" || value === null || value === seen || depth > 3) return;
    let tag: string;
    try {
      tag = apply(toTag, value, []) as string;
    } catch {
      return;
    }
    if (tag === "[object String]") return scanText(where, apply(stringValue, value, []) as string);
    if (tag === "[object URL]") {
      try {
        scanText(where, apply(hrefOf, value, []) as string);
      } catch {
        // Something else with URL's tag.
      }
      return;
    }
    if (tag === "[object Uint8Array]") {
      try {
        scanText(where, apply(decode, decoder, [value]) as string);
      } catch {
        // Bytes that are no text carry no marker either.
      }
      return;
    }
    if (tag === "[object Promise]") {
      apply(nativeThen, value, [(settled: unknown) => watch(`${where} settled`, settled), () => {}]);
      return;
    }
    if (tag !== "[object Array]" && tag !== "[object Object]") return;
    let keys: Array<string | symbol>;
    try {
      keys = ownKeys(value);
    } catch {
      return;
    }
    for (let index = 0; index < keys.length && index < 64; index++) {
      try {
        const descriptor = getDescriptor(value, keys[index] as string | symbol);
        if (descriptor && "value" in descriptor) scan(where, descriptor.value, depth + 1);
      } catch {
        // A proxy may refuse.
      }
    }
  };
  const watchCall = (where: string, self: unknown, args: ArrayLike<unknown>) => {
    if (busy) return;
    busy = true;
    try {
      scan(where, self, 0);
      for (let index = 0; index < args.length; index++) scan(where, args[index], 0);
    } finally {
      busy = false;
    }
  };

  const restores: Array<() => void> = [];
  const replace = (owner: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
    const original = getDescriptor(owner, key);
    defineProperty(owner, key, { __proto__: null, configurable: true, ...descriptor } as PropertyDescriptor);
    apply(nativePush, restores, [() => (original ? defineProperty(owner, key, original) : deleteProperty(owner, key))]);
  };
  const wrap = (original: AnyFunction, where: string): AnyFunction =>
    function (this: unknown, ...args: unknown[]) {
      watchCall(where, new.target ? undefined : this, args);
      return new.target ? construct(original, args, new.target) : apply(original, this, args);
    };

  // Indexed: the array iterator is among the first built-ins wrapped.
  for (let entry = 0; entry < METHODS.length; entry++) {
    const row = METHODS[entry] as [object, string, Array<string | symbol>];
    const owner = row[0];
    const label = row[1];
    const keys = row[2];
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index] as string | symbol;
      const original = getDescriptor(owner, key)?.value as AnyFunction | undefined;
      if (typeof original !== "function") continue;
      const where = `${label}.${typeof key === "symbol" ? key.description : key}`;
      replace(owner, key, { value: wrap(original, where), writable: true });
    }
  }
  for (let index = 0; index < URL_PARTS.length; index++) {
    const part = URL_PARTS[index] as string;
    const original = getDescriptor(URL.prototype, part) as PropertyDescriptor;
    const get = original.get as AnyFunction;
    replace(URL.prototype, part, {
      get(this: unknown) {
        watchCall(`URL.prototype.${part}`, this, []);
        return apply(get, this, []);
      },
      set: original.set,
    });
  }
  replace(Promise.prototype, "constructor", {
    get(this: unknown) {
      watchCall("Promise.prototype.constructor", this, []);
      return NativePromise;
    },
    set() {},
  });
  replace(Object.prototype, "then", {
    get(this: unknown) {
      watchCall("Object.prototype.then", this, []);
      return undefined;
    },
    set() {},
  });
  // A page can add these: a string separator or search value is looked up as an object.
  const splitter = String.prototype as unknown as Record<symbol, unknown>;
  replace(String.prototype, Symbol.split, {
    value(this: string, text: string, limit?: number) {
      watchCall("String.prototype[Symbol.split]", this, [text]);
      const added = getDescriptor(splitter, Symbol.split) as PropertyDescriptor;
      deleteProperty(splitter, Symbol.split);
      try {
        return apply(nativeSplit, text, [this, limit]);
      } finally {
        defineProperty(splitter, Symbol.split, added);
      }
    },
    writable: true,
  });
  replace(String.prototype, Symbol.replace, {
    value(this: string, text: string, replacement: unknown) {
      watchCall("String.prototype[Symbol.replace]", this, [text]);
      const added = getDescriptor(splitter, Symbol.replace) as PropertyDescriptor;
      deleteProperty(splitter, Symbol.replace);
      try {
        return apply(nativeReplace, text, [this, replacement]);
      } finally {
        defineProperty(splitter, Symbol.replace, added);
      }
    },
    writable: true,
  });
  const scope = globalThis as unknown as Record<string, AnyFunction>;
  for (let index = 0; index < GLOBALS.length; index++) {
    const name = GLOBALS[index] as string;
    const original = scope[name] as AnyFunction;
    const wrapped = wrap(original, name);
    const keys = ownKeys(original);
    for (let key = 0; key < keys.length; key++) {
      const own = keys[key] as string | symbol;
      if (own !== "length" && own !== "name")
        defineProperty(wrapped, own, getDescriptor(original, own) as PropertyDescriptor);
    }
    replace(globalThis, name, { value: wrapped, writable: true });
  }

  try {
    await run();
    // Lets watched promises settle while the wrappers are still in.
    await new NativePromise((resolve) => setTimeout(resolve, 0));
  } finally {
    for (let index = restores.length - 1; index >= 0; index--) (restores[index] as () => void)();
  }
  return seen;
}
