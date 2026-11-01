import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installServiceWorkerMask } from "../src/client/sw-mask.ts";
import type { Realm } from "../src/client/url-context.ts";
import { spyBuiltins } from "./spied-builtins.ts";

// Taken before the spies wrap Reflect.
const reflectGet = Reflect.get;

/** A window's own classes, from another realm than the runtime's, as in a window the browser reused. */
function pageWindow() {
  return runInNewContext(`({
    Promise,
    Array,
    Object,
    EventTarget: class EventTarget {
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
    },
    DOMException: class DOMException extends Error {
      constructor(message, name) { super(message); this.name = name; }
    },
    Navigator: class Navigator {},
  })`) as Realm;
}

describe("installServiceWorkerMask", () => {
  it("hands the page nothing of the realm that made its runtime, and takes nothing of the page into it", async () => {
    const win = pageWindow();
    const answers: unknown[] = [0, 0];
    const seen = await spyBuiltins("never", async () => {
      installServiceWorkerMask(win);
      const container = reflectGet(win.Navigator.prototype, "serviceWorker") as ServiceWorkerContainer;
      answers[0] = await container.getRegistrations();
      answers[1] = await container.register("/sw.js").catch((error: Error) => error.name);
    });
    expect(seen).toEqual([]);
    expect(answers).toEqual([[], "SecurityError"]);
    expect(Object.getPrototypeOf(answers[0])).toBe(win.Array.prototype);
  });
});
