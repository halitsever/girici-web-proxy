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
const hasOwn = Object.prototype.hasOwnProperty;
const protoOf = Reflect.getPrototypeOf;
const objectProto = Object.prototype;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const NativeTypeError = TypeError;
const DESCRIPTOR_KEYS = ["value", "writable", "get", "set", "enumerable", "configurable"];

/** A descriptor's own fields on a null prototype, valid while the wrappers add descriptor fields to Object.prototype. */
function ownFields(descriptor: PropertyDescriptor | undefined): PropertyDescriptor {
  const copy = { __proto__: null } as Record<string, unknown>;
  for (let index = 0; index < DESCRIPTOR_KEYS.length; index++) {
    const key = DESCRIPTOR_KEYS[index] as string;
    if (descriptor && apply(hasOwn, descriptor, [key])) copy[key] = (descriptor as Record<string, unknown>)[key];
  }
  return copy as PropertyDescriptor;
}

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
  [Object.prototype, "Object.prototype", ["toString", "valueOf"]],
  [
    Reflect,
    "Reflect",
    [
      "apply",
      "construct",
      "defineProperty",
      "deleteProperty",
      "get",
      "getOwnPropertyDescriptor",
      "getPrototypeOf",
      "has",
      "ownKeys",
      "set",
    ],
  ],
];
const URL_PARTS = ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"];
const GLOBALS = ["atob", "String", "Number", "URL", "TextDecoder", "parseInt", "Proxy"];
/** Fields the engine and the natives it calls read; a page's accessors on Object.prototype see any that are missing. */
const FIELDS = [
  "cookies",
  "changes",
  "name",
  "domain",
  "path",
  "expires",
  "creation",
  "cookiesBlocked",
  "transfer",
  "ignoreSearch",
];
/** Descriptor fields: present on Object.prototype, they break descriptor literals, so they stay only for run's sync part. */
const DESCRIPTOR_FIELDS = ["value", "get", "set"];
const INDICES = ["0", "1", "2", "3"];

/**
 * Runs `run` while this realm's built-ins are a page's wrappers that pass every call on, and returns each value
 * carrying `marker`, or each object of another realm, that reached one of them, as `where: text`. Promises that pass
 * through are watched until they settle, so a value they carry later counts too.
 */
export async function spyBuiltins(
  marker: string,
  run: () => unknown,
  { descriptorFields = true }: { descriptorFields?: boolean } = {},
): Promise<string[]> {
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
  /** Whether the prototype chain ends at another realm's Object.prototype; a null-prototype object belongs to none. */
  const foreign = (value: object): boolean => {
    let current = value;
    for (let step = 0; step < 32; step++) {
      let next: object | null;
      try {
        next = protoOf(current);
      } catch {
        return false;
      }
      if (next === null) return current !== value && current !== objectProto;
      current = next;
    }
    return false;
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
    if (foreign(value)) return note(where, `an object of another realm, ${tag}`);
    if (tag === "[object Map]" || tag === "[object Set]") {
      const each = (item: unknown, key: unknown) => {
        scan(where, key, depth + 1);
        scan(where, item, depth + 1);
      };
      apply(tag === "[object Map]" ? mapForEach : setForEach, value, [each]);
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
        if (descriptor && apply(hasOwn, descriptor, ["value"])) scan(where, descriptor.value, depth + 1);
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
    const original = getDescriptor(owner, key) && ownFields(getDescriptor(owner, key));
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
      const added = ownFields(getDescriptor(splitter, Symbol.split));
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
      const added = ownFields(getDescriptor(splitter, Symbol.replace));
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
  replace(Object.prototype, Symbol.toPrimitive, {
    value(this: Record<string, unknown>, hint: string) {
      watchCall("Object.prototype[Symbol.toPrimitive]", this, []);
      // OrdinaryToPrimitive, so conversions keep working.
      const tryMethod = (name: string): { done: boolean; result?: unknown } => {
        const method = this[name];
        if (typeof method !== "function") return { __proto__: null, done: false } as { done: boolean };
        const result: unknown = apply(method as AnyFunction, this, []);
        const primitive = result === null || (typeof result !== "object" && typeof result !== "function");
        return { __proto__: null, done: primitive, result } as { done: boolean; result?: unknown };
      };
      const first = tryMethod(hint === "string" ? "toString" : "valueOf");
      if (first.done) return first.result;
      const second = tryMethod(hint === "string" ? "valueOf" : "toString");
      if (second.done) return second.result;
      throw new NativeTypeError("Cannot convert object to primitive value");
    },
    writable: true,
  });
  /** An accessor that notes who reads or writes `key` through the prototype, and stores writes as own data. */
  const field = (key: string, where: string): PropertyDescriptor =>
    ({
      __proto__: null,
      get(this: unknown) {
        watchCall(where, this, []);
        return undefined;
      },
      set(this: unknown, value: unknown) {
        watchCall(where, this, [value]);
        if ((typeof this === "object" && this !== null) || typeof this === "function") {
          defineProperty(this, key, {
            __proto__: null,
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          } as PropertyDescriptor);
        }
      },
      enumerable: false,
      configurable: true,
    }) as PropertyDescriptor;
  for (let index = 0; index < FIELDS.length; index++) {
    const key = FIELDS[index] as string;
    replace(Object.prototype, key, field(key, `Object.prototype.${key}`));
  }
  for (let index = 0; index < INDICES.length; index++) {
    const key = INDICES[index] as string;
    replace(Array.prototype, key, field(key, `Array.prototype[${key}]`));
  }

  const descriptorRestores: Array<() => void> = [];
  try {
    for (let index = 0; descriptorFields && index < DESCRIPTOR_FIELDS.length; index++) {
      const key = DESCRIPTOR_FIELDS[index] as string;
      defineProperty(Object.prototype, key, field(key, `Object.prototype.${key}`));
      apply(nativePush, descriptorRestores, [() => deleteProperty(Object.prototype, key)]);
    }
    let pending: unknown;
    try {
      pending = run();
    } finally {
      for (let index = descriptorRestores.length - 1; index >= 0; index--) (descriptorRestores[index] as () => void)();
    }
    await pending;
    // Lets watched promises settle while the wrappers are still in.
    await new NativePromise((resolve) => setTimeout(resolve, 0));
  } finally {
    for (let index = descriptorRestores.length - 1; index >= 0; index--) (descriptorRestores[index] as () => void)();
    for (let index = restores.length - 1; index >= 0; index--) (restores[index] as () => void)();
  }
  return seen;
}
