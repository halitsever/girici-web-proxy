import { installAttributes } from "./attributes.ts";
import { installDocument } from "./document.ts";
import { createHelpers } from "./helpers.ts";
import { createFakeLocation } from "./location.ts";
import { installNavigation } from "./navigation.ts";
import { installNetwork } from "./network.ts";
import { installStorage } from "./storage.ts";
import { installServiceWorkerMask } from "./sw-mask.ts";
import { createUrlContext, type Realm } from "./url-context.ts";

export function install(win: Realm): void {
  const ctx = createUrlContext(win);
  const nativeLocation = win.location;
  const fakeLocation = createFakeLocation(
    {
      real: () => ctx.realUrl(),
      navigate: (url, mode) => (mode === "replace" ? nativeLocation.replace(url) : nativeLocation.assign(url)),
      reload: () => nativeLocation.reload(),
      setHash: (hash) => {
        nativeLocation.hash = hash;
      },
    },
    win.Location.prototype,
  );
  const helpers = createHelpers({
    nativeLocation,
    fakeLocation,
    isLocation,
    fakeFor: (location) => fakeFor(win, location),
    isWindowOrDocument: (value) => {
      try {
        return typeof value === "object" && value !== null && "location" in value && isLocation(value.location);
      } catch {
        return false;
      }
    },
    toProxy: (raw) => ctx.toProxy(raw),
  });
  // Rewritten scripts call __g$, so it exists before anything else is attempted.
  Object.defineProperty(win, "__g$", { value: helpers, enumerable: false });

  const steps: Array<[string, () => void]> = [
    ["document", () => installDocument(win, ctx)],
    ["attributes", () => installAttributes(win, ctx)],
    ["navigation", () => installNavigation(win, ctx)],
    ["service worker mask", () => installServiceWorkerMask(win)],
    ["network", () => installNetwork(win, ctx)],
    ["storage", () => installStorage(win, ctx)],
  ];
  for (const [name, step] of steps) {
    try {
      step();
    } catch (error) {
      // One browser difference should cost one hook, not the whole page.
      console.warn("Girici:", name, error);
    }
  }
}

function isLocation(value: unknown): boolean {
  try {
    return Object.prototype.toString.call(value) === "[object Location]";
  } catch {
    return false;
  }
}

/** Other same-origin windows have their own runtime and stand-in, reached through their __g$. */
function fakeFor(win: Realm, location: object): object | null {
  const candidates: Array<Window | null> = [win.parent, win.top, win.opener as Window | null];
  for (let index = 0; index < win.frames.length; index++) candidates.push(win.frames[index] ?? null);
  for (const candidate of candidates) {
    try {
      if (candidate && candidate !== win && candidate.location === location) {
        const helpers = (candidate as unknown as { __g$?: { L(value: unknown): unknown } }).__g$;
        return helpers ? (helpers.L(location) as object) : null;
      }
    } catch {
      // Cross-origin windows throw on access and cannot be helped.
    }
  }
  return null;
}
