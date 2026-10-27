import type { Realm } from "./url-context.ts";

/** A proxied page must neither install its own worker nor see or unregister ours. */
export function installServiceWorkerMask(win: Realm): void {
  const events = new win.EventTarget();
  const container = {
    register: () =>
      Promise.reject(new win.DOMException("Service workers are not available through Girici", "SecurityError")),
    getRegistration: () => Promise.resolve(undefined),
    getRegistrations: () => Promise.resolve([]),
    startMessages: () => {},
    controller: null,
    ready: new Promise<never>(() => {}),
    oncontrollerchange: null,
    onmessage: null,
    onmessageerror: null,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  Object.defineProperty(win.Navigator.prototype, "serviceWorker", {
    configurable: true,
    enumerable: true,
    get: () => container,
  });
}
