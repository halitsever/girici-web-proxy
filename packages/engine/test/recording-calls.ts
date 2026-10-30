type AnyFunction = (...args: unknown[]) => unknown;

/** Runs `run` while Function.prototype.call and apply are page replacements that note every function they invoke. */
export function recordingCalls(run: () => void): unknown[] {
  const seen: unknown[] = [];
  const apply = Reflect.apply;
  const call = Object.getOwnPropertyDescriptor(Function.prototype, "call") as PropertyDescriptor;
  const applyMethod = Object.getOwnPropertyDescriptor(Function.prototype, "apply") as PropertyDescriptor;
  Object.defineProperty(Function.prototype, "call", {
    ...call,
    value(this: AnyFunction, self: unknown, ...args: unknown[]) {
      seen.push(this);
      return apply(this, self, args);
    },
  });
  Object.defineProperty(Function.prototype, "apply", {
    ...applyMethod,
    value(this: AnyFunction, self: unknown, args?: ArrayLike<unknown>) {
      seen.push(this);
      return apply(this, self, args ?? []);
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(Function.prototype, "call", call);
    Object.defineProperty(Function.prototype, "apply", applyMethod);
  }
  return seen;
}
