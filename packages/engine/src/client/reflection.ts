import { define, NativeWeakMap } from "../shared/primordials.ts";
import { propertyKey } from "./helpers.ts";
import { maskNative } from "./native-mask.ts";
import type { Realm } from "./url-context.ts";

export interface ReflectionEnv {
  /** A Location becomes its stand-in and another window its wrapper; anything else comes back as is. */
  settle(value: unknown): unknown;
  /** Navigates a window or a document to a URL the page gave, inside the proxy. */
  navigate(target: object, url: unknown): void;
  /** Checked without running a page's getters or proxy traps. */
  isWindowOrDocument(value: unknown): boolean;
  /** This window's real Location, swapped wherever a result holds it. */
  nativeLocation: object;
  /** This window and its document, whose every value is settled. */
  isOwn(value: unknown): boolean;
}

type AnyFunction = (...args: unknown[]) => unknown;
type Descriptor = PropertyDescriptor & { get?: AnyFunction; set?: AnyFunction };

// Taken at load: the hooks run inside page calls, after page code may have replaced any of these.
const apply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const reflectProto = Reflect.getPrototypeOf;
const nativeOwnDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.prototype.hasOwnProperty;
const isEnumerable = Object.prototype.propertyIsEnumerable;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;
const NativeObject = Object;

/**
 * Reflection reaches `location` and frames by keys no rewrite sees. A window is checked only for a `location` key or
 * this window itself, so ordinary objects keep their cost and see no extra trap.
 */
export function installReflection(win: Realm, env: ReflectionEnv): void {
  const reflect = win.Reflect;
  const object = win.Object;
  const TypeError = win.TypeError;
  const reflectGet = reflect.get as AnyFunction;
  const reflectSet = reflect.set as AnyFunction;
  const reflectDescriptor = reflect.getOwnPropertyDescriptor as AnyFunction;
  const objectDescriptor = object.getOwnPropertyDescriptor as AnyFunction;
  const objectDescriptors = object.getOwnPropertyDescriptors as AnyFunction;
  const assign = object.assign as AnyFunction;
  const values = object.values as AnyFunction;
  const entries = object.entries as AnyFunction;
  const proto = object.prototype as { __lookupGetter__?: AnyFunction; __lookupSetter__?: AnyFunction };
  const lookupGetter = proto.__lookupGetter__;
  const lookupSetter = proto.__lookupSetter__;

  const quick = (value: unknown): unknown => (value === env.nativeLocation ? env.settle(value) : value);
  const keyOf = (key: unknown): unknown =>
    (typeof key === "object" && key !== null) || typeof key === "function" ? propertyKey(key) : key;

  // One stand-in per native accessor, so two lookups of the same property compare equal.
  const accessors = new NativeWeakMap<AnyFunction, AnyFunction>();
  const standIn = (native: AnyFunction, setter: boolean): AnyFunction => {
    let hooked = apply(mapGet, accessors, [native]) as AnyFunction | undefined;
    if (hooked) return hooked;
    hooked = setter
      ? function (this: unknown, url: unknown) {
          if (env.isWindowOrDocument(this)) env.navigate(this as object, url);
          else apply(native, this, [url]);
        }
      : function (this: unknown) {
          return env.settle(apply(native, this, []));
        };
    copyShape(hooked, native);
    apply(mapSet, accessors, [native, maskNative(hooked, native)]);
    return hooked;
  };

  /** Swaps the native `location` accessors and settles a value, on a fresh descriptor the native just made. */
  const settleDescriptor = (
    target: unknown,
    key: unknown,
    descriptor: Descriptor | undefined,
  ): Descriptor | undefined => {
    if (!descriptor) return descriptor;
    const own = env.isOwn(target);
    if (key === "location" || key === "top" ? own || env.isWindowOrDocument(target) : own) {
      if (isSettledAccessor(key, false) && typeof descriptor.get === "function") {
        descriptor.get = standIn(descriptor.get, false);
      }
      if (isSettledAccessor(key, true) && typeof descriptor.set === "function") {
        descriptor.set = standIn(descriptor.set, true);
      }
      if (apply(hasOwn, descriptor, ["value"])) descriptor.value = env.settle(descriptor.value);
    } else if (apply(hasOwn, descriptor, ["value"])) descriptor.value = quick(descriptor.value);
    return descriptor;
  };

  const hook = (target: object, name: string, native: AnyFunction | undefined, hooked: AnyFunction): void => {
    if (typeof native !== "function") return;
    const descriptor = nativeOwnDescriptor(target, name);
    if (!descriptor?.configurable) return;
    copyShape(hooked, native);
    define(target, name, { ...descriptor, value: maskNative(hooked, native) });
  };

  hook(reflect, "get", reflectGet, function (target: unknown, key: unknown, receiver?: unknown) {
    const property = keyOf(key);
    const value: unknown =
      arguments.length > 2
        ? apply(reflectGet, reflect, [target, property, receiver])
        : apply(reflectGet, reflect, [target, property]);
    return property === "location" || env.isOwn(target) ? env.settle(value) : quick(value);
  });

  hook(reflect, "set", reflectSet, function (target: unknown, key: unknown, value: unknown, receiver?: unknown) {
    const property = keyOf(key);
    // With another receiver the native setter would refuse it, so only a write to the window itself navigates.
    if (property === "location" && (arguments.length < 4 || receiver === target) && env.isWindowOrDocument(target)) {
      env.navigate(target as object, value);
      return true;
    }
    return arguments.length > 3
      ? apply(reflectSet, reflect, [target, property, value, receiver])
      : apply(reflectSet, reflect, [target, property, value]);
  });

  const describe = (holder: object, native: AnyFunction): void =>
    hook(holder, "getOwnPropertyDescriptor", native, function (target: unknown, key: unknown) {
      const property = keyOf(key);
      return settleDescriptor(target, property, apply(native, holder, [target, property]) as Descriptor | undefined);
    });
  describe(reflect, reflectDescriptor);
  describe(object, objectDescriptor);

  hook(object, "getOwnPropertyDescriptors", objectDescriptors, function (target: unknown) {
    const descriptors = apply(objectDescriptors, object, [target]) as Record<PropertyKey, Descriptor>;
    // Another window is checked only when it holds `location`, so ordinary objects pay one own-key test.
    if (env.isOwn(target) || (apply(hasOwn, descriptors, ["location"]) && env.isWindowOrDocument(target))) {
      const keys = reflectOwnKeys(descriptors);
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index] as PropertyKey;
        settleDescriptor(target, key, descriptors[key]);
      }
    }
    return descriptors;
  });

  hook(object, "values", values, function (target: unknown) {
    const list = apply(values, object, [target]) as unknown[];
    const own = env.isOwn(target);
    for (let index = 0; index < list.length; index++) {
      list[index] = own ? env.settle(list[index]) : quick(list[index]);
    }
    return list;
  });

  hook(object, "entries", entries, function (target: unknown) {
    const list = apply(entries, object, [target]) as Array<[string, unknown]>;
    const own = env.isOwn(target);
    let checked: boolean | undefined;
    for (let index = 0; index < list.length; index++) {
      const entry = list[index] as [string, unknown];
      if (own) entry[1] = env.settle(entry[1]);
      else if (entry[0] === "location" && (checked ??= env.isWindowOrDocument(target))) entry[1] = env.settle(entry[1]);
      else entry[1] = quick(entry[1]);
    }
    return list;
  });

  hook(object, "assign", assign, function (target: unknown) {
    // Indexed through `arguments`: a rest parameter would run the page's array iterator.
    // eslint-disable-next-line prefer-rest-params
    const args = arguments;
    let guarded = env.isOwn(target);
    for (let index = 1; !guarded && index < args.length; index++) {
      const source: unknown = args[index];
      guarded =
        env.isOwn(source) ||
        (typeof source === "object" &&
          source !== null &&
          apply(hasOwn, source, ["location"]) &&
          env.isWindowOrDocument(target));
    }
    if (!guarded || target === null || target === undefined) return apply(assign, object, args);
    const to = NativeObject(target) as object;
    const navigable = env.isWindowOrDocument(to);
    for (let index = 1; index < args.length; index++) {
      const source: unknown = args[index];
      if (source === null || source === undefined) continue;
      const from = NativeObject(source) as object;
      const settled = env.isOwn(from);
      const keys = reflectOwnKeys(from);
      for (let at = 0; at < keys.length; at++) {
        const key = keys[at] as PropertyKey;
        if (!apply(isEnumerable, from, [key])) continue;
        let value: unknown = apply(reflectGet, reflect, [from, key, from]);
        if (settled) value = env.settle(value);
        if (key === "location" && navigable) env.navigate(to, value);
        else if (!apply(reflectSet, reflect, [to, key, value, to])) {
          throw new TypeError(`Cannot assign to read only property '${typeof key === "symbol" ? "symbol" : key}'`);
        }
      }
    }
    return to;
  });

  const lookup = (name: string, native: AnyFunction | undefined, setter: boolean): void =>
    hook(proto, name, native, function (this: unknown, key: unknown) {
      const property = keyOf(key);
      const found = apply(native as AnyFunction, this, [property]);
      if (!isSettledAccessor(property, setter) || typeof found !== "function") return found;
      // The accessor is a window's or a document's when the object along the chain that holds it is one.
      for (let holder: unknown = NativeObject(this); holder; holder = reflectProto(holder as object)) {
        if (!nativeOwnDescriptor(holder, property as string)) continue;
        return env.isWindowOrDocument(holder) ? standIn(found as AnyFunction, setter) : found;
      }
      return found;
    });
  lookup("__lookupGetter__", lookupGetter, false);
  lookup("__lookupSetter__", lookupSetter, true);
}

/** The native's name and length, which pages that fingerprint builtins compare. */
function copyShape(hooked: AnyFunction, native: AnyFunction): void {
  const name = nativeOwnDescriptor(native, "name");
  const length = nativeOwnDescriptor(native, "length");
  if (name) define(hooked, "name", name);
  if (length) define(hooked, "length", length);
}

/** `top` is fixed on every window, so its getter is the one window link no hook replaces. */
function isSettledAccessor(key: unknown, setter: boolean): boolean {
  return key === "location" || (!setter && key === "top");
}
