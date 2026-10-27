import { encodeUrl } from "../shared/codec.ts";

export interface LocationEnv {
  real(): URL;
  navigate(url: string, mode: "assign" | "replace"): void;
  reload(): void;
  setHash(hash: string): void;
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
    const current = env.real();
    const target = new URL(String(value), current);
    if (isFragmentNavigation(target, current)) {
      env.setHash(target.hash);
      return;
    }
    const web = target.protocol === "http:" || target.protocol === "https:";
    env.navigate(web ? encodeUrl(target) : target.href, mode);
  };

  const properties: PropertyDescriptorMap = {
    href: { get: () => env.real().href, set: (value: unknown) => go(value, "assign"), enumerable: true },
    origin: { get: () => env.real().origin, enumerable: true },
    hash: {
      get: () => env.real().hash,
      set: (value: unknown) => {
        const next = new URL(env.real().href);
        next.hash = String(value);
        env.setHash(next.hash);
      },
      enumerable: true,
    },
    assign: { value: (url: unknown) => go(url, "assign") },
    replace: { value: (url: unknown) => go(url, "replace") },
    reload: { value: () => env.reload() },
    toString: { value: () => env.real().href },
    [Symbol.toStringTag]: { value: "Location" },
  };
  for (const part of NAVIGATING_PARTS) {
    properties[part] = {
      get: () => env.real()[part],
      set: (value: unknown) => {
        const next = new URL(env.real().href);
        next[part] = String(value);
        go(next, "assign");
      },
      enumerable: true,
    };
  }
  return Object.create(proto, properties) as FakeLocation;
}

/** Browsers only scroll when the target differs from the current URL in its fragment alone. */
function isFragmentNavigation(target: URL, current: URL): boolean {
  if (!target.href.includes("#")) return false;
  return withoutFragment(target) === withoutFragment(current);
}

function withoutFragment(url: URL): string {
  const index = url.href.indexOf("#");
  return index < 0 ? url.href : url.href.slice(0, index);
}
