import { encodeUrl } from "../shared/codec.ts";
import {
  hashOf,
  hrefOf,
  includes,
  indexOf,
  isWebUrl,
  newUrl,
  originOf,
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

/** The real Location object cannot be replaced, so rewritten scripts get this stand-in that speaks in real URLs. */
export function createFakeLocation(env: LocationEnv, proto: object = Object.prototype): FakeLocation {
  const go = (value: unknown, mode: "assign" | "replace") => {
    // Converted once, so a value cannot read as a web URL to the check and as javascript: to the parser.
    const text = toText(value);
    const script = rewriteJavascriptUrl(text, env.owner ? env.owner() : originOf(env.real()));
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
    env.navigate(isWebUrl(target) ? encodeUrl(target) : hrefOf(target), mode);
  };

  const properties: PropertyDescriptorMap = {
    href: { get: () => hrefOf(env.real()), set: (value: unknown) => go(value, "assign"), enumerable: true },
    origin: { get: () => urlPart(env.real(), "origin"), enumerable: true },
    hash: {
      get: () => hashOf(env.real()),
      set: (value: unknown) => {
        const next = newUrl(hrefOf(env.real()));
        setUrlPart(next, "hash", toText(value));
        env.setHash(hashOf(next));
      },
      enumerable: true,
    },
    assign: { value: (url: unknown) => go(url, "assign") },
    replace: { value: (url: unknown) => go(url, "replace") },
    reload: { value: () => env.reload() },
    toString: { value: () => hrefOf(env.real()) },
    [Symbol.toStringTag]: { value: "Location" },
  };
  // Indexed: stand-ins are made inside page calls, after the page may have replaced the array iterator.
  for (let index = 0; index < NAVIGATING_PARTS.length; index++) {
    const part = NAVIGATING_PARTS[index] as NavigatingPart;
    properties[part] = {
      get: () => urlPart(env.real(), part),
      set: (value: unknown) => {
        const next = newUrl(hrefOf(env.real()));
        setUrlPart(next, part, toText(value));
        go(hrefOf(next), "assign");
      },
      enumerable: true,
    };
  }
  return Object.create(proto, properties) as FakeLocation;
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
