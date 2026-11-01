import { apply, define } from "../shared/primordials.ts";
import type { Realm } from "./url-context.ts";

// Taken at load: install runs inside the page call that adopts a window.
const bind = Function.prototype.bind;

/** A proxied page must neither install its own worker nor see or unregister ours. */
export function installServiceWorkerMask(win: Realm): void {
  // The window's own Promise and Array, since a page that reuses the window awaits and reads what these answer.
  const PagePromise = win.Promise;
  const PageArray = win.Array;
  const PageDOMException = win.DOMException;
  const events = new win.EventTarget();
  const bound = (method: unknown) => apply(bind, method, [events]) as EventTarget["addEventListener"];
  const container = {
    register: () =>
      new PagePromise((_resolve, reject) =>
        reject(new PageDOMException("Service workers are not available through Girici", "SecurityError")),
      ),
    getRegistration: () => new PagePromise((resolve) => resolve(undefined)),
    getRegistrations: () => new PagePromise((resolve) => resolve(new PageArray())),
    startMessages: () => {},
    controller: null,
    ready: new PagePromise<never>(() => {}),
    oncontrollerchange: null,
    onmessage: null,
    onmessageerror: null,
    addEventListener: bound(events.addEventListener),
    removeEventListener: bound(events.removeEventListener),
    dispatchEvent: bound(events.dispatchEvent),
  };
  define(win.Navigator.prototype, "serviceWorker", {
    configurable: true,
    enumerable: true,
    get: () => container,
  });
}
