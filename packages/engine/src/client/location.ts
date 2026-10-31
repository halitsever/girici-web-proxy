import { encodeUrl } from "../shared/codec.ts";
import {
  hashOf,
  hrefOf,
  includes,
  indexOf,
  isWebUrl,
  newUrl,
  originOf,
  ownValue,
  setUrlPart,
  sliceOf,
  toText,
  urlPart,
} from "../shared/primordials.ts";
import { rewriteJavascriptUrl } from "../shared/url-rewrite.ts";

export interface LocationEnv {
  real(): URL;
  navigate(url: string, mode: "assign" | "replace"): void;
  reload(): void;
  setHash(hash: string): void;
  /** The real origin of the realm that navigates, which its javascript: URLs carry; defaults to `real()`'s. */
  owner?(): string;
  /** The address a web target loads at in this window; a sealed page seals its own origin. Defaults to encodeUrl. */
  address?(url: URL): string;
}

export type FakeLocation = Pick<
  Location,
  | "href"
  | "origin"
  | "protocol"
  | "host"
  | "hostname"
  | "port"
  | "pathname"
  | "search"
  | "hash"
  | "assign"
  | "replace"
  | "reload"
  | "toString"
>;

type NavigatingPart = "protocol" | "host" | "hostname" | "port" | "pathname" | "search";

const NAVIGATING_PARTS: NavigatingPart[] = ["protocol", "host", "hostname", "port", "pathname", "search"];

// Taken at load: stand-ins are made inside page calls.
const create = Object.create;
const toStringTag = Symbol.toStringTag;

/** The real Location object cannot be replaced, so rewritten scripts get this stand-in that speaks in real URLs. */
export function createFakeLocation(env: LocationEnv, proto: object = Object.prototype): FakeLocation {
  const go = (value: unknown, mode: "assign" | "replace") => {
    // Converted once, so a value cannot read as a web URL to the check and as javascript: to the parser.
    const text = toText(value);
    // Own members only: an env a page's Object.prototype could fill in would let it pick the owner or the address.
    const owner = ownValue(env, "owner");
    const address = ownValue(env, "address");
    const script = rewriteJavascriptUrl(text, typeof owner === "function" ? toText(owner()) : originOf(env.real()));
    if (script !== null) {
      env.navigate(script, mode);
      return;
    }
    const current = env.real();
    const target = newUrl(text, current);
    if (isFragmentNavigation(target, current)) {
      env.setHash(hashOf(target));
      return;
    }
    if (!isWebUrl(target)) env.navigate(hrefOf(target), mode);
    else env.navigate(typeof address === "function" ? toText(address(target)) : encodeUrl(target), mode);
  };

  // Null prototypes throughout, so no descriptor field comes from the page's Object.prototype.
  const properties = {
    __proto__: null,
    href: {
      __proto__: null,
      get: () => hrefOf(env.real()),
      set: (value: unknown) => go(value, "assign"),
      enumerable: true,
    },
    origin: { __proto__: null, get: () => urlPart(env.real(), "origin"), enumerable: true },
    hash: {
      __proto__: null,
      get: () => hashOf(env.real()),
      set: (value: unknown) => {
        const next = newUrl(hrefOf(env.real()));
        setUrlPart(next, "hash", toText(value));
        env.setHash(hashOf(next));
      },
      enumerable: true,
    },
    assign: { __proto__: null, value: (url: unknown) => go(url, "assign") },
    replace: { __proto__: null, value: (url: unknown) => go(url, "replace") },
    reload: { __proto__: null, value: () => env.reload() },
    toString: { __proto__: null, value: () => hrefOf(env.real()) },
    [toStringTag]: { __proto__: null, value: "Location" },
  } as unknown as PropertyDescriptorMap;
  // Indexed: stand-ins are made inside page calls, after the page may have replaced the array iterator.
  for (let index = 0; index < NAVIGATING_PARTS.length; index++) {
    const part = NAVIGATING_PARTS[index] as NavigatingPart;
    properties[part] = {
      __proto__: null,
      get: () => urlPart(env.real(), part),
      set: (value: unknown) => {
        const next = newUrl(hrefOf(env.real()));
        setUrlPart(next, part, toText(value));
        go(hrefOf(next), "assign");
      },
      enumerable: true,
    } as PropertyDescriptor;
  }
  return create(proto, properties) as FakeLocation;
}

/** Browsers only scroll when the target differs from the current URL in its fragment alone. */
function isFragmentNavigation(target: URL, current: URL): boolean {
  if (!includes(hrefOf(target), "#")) return false;
  return withoutFragment(target) === withoutFragment(current);
}

function withoutFragment(url: URL): string {
  const href = hrefOf(url);
  const index = indexOf(href, "#");
  return index < 0 ? href : sliceOf(href, 0, index);
}
