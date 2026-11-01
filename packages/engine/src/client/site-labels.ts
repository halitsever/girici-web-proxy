/**
 * In subdomain mode another site's window lives on another host, so postMessage needs that host as its native target
 * and the receiver needs the sender's real origin back. Labels come from the config, verified messages and the worker.
 */

import {
  apply,
  endsWith,
  hostOf as hostPart,
  isWebUrl,
  NativeMap,
  originOf,
  ownValue,
  parseJson,
  parseUrl,
  protocolOf,
  quoteJson,
  urlPart,
} from "../shared/primordials.ts";
import {
  LABEL_RPC_PATH,
  MESSAGE_ENVELOPE,
  PROTOCOL_VERSION,
  type MessageEnvelope,
  type SiteContext,
} from "../shared/protocol.ts";
import { fromBase64Url } from "../shared/seal-cipher.ts";
import { readMessageEnvelope } from "../shared/site-config.ts";
import { classifySiteHost, siteLabel, type SiteDomain } from "../shared/site-label.ts";

// Taken at load: lookups settle inside page calls, after page code may have replaced these.
const NativePromise = Promise;
const promiseThen = Promise.prototype.then;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const responseText = Response.prototype.text;

/** The worker's answer for one origin: its host, null when it names none, undefined when the lookup failed. */
export type LabelLookup = (realOrigin: string) => Promise<string | null | undefined>;

/** A message from another site host whose envelope checks out; `sure` once its origin is known to live on `host`. */
export interface SiteClaim {
  origin: string;
  target: string;
  data: unknown;
  /** The sender's host. */
  host: string;
  sure: boolean;
}

const SAME = 1;
const UNDER = 2;

export interface SiteLabels {
  /** The host serving `realOrigin`, when a lookup or a verified message has named it. */
  hostOf(realOrigin: string): string | null;
  resolve(realOrigin: string): Promise<string | null>;
  envelope(data: unknown, target: string): MessageEnvelope;
  /**
   * The sender's claim, when its site's label is its host's and no lookup placed its origin on another host. Undefined
   * when the sender is no other site host of this instance.
   */
  verify(nativeOrigin: string, value: unknown): SiteClaim | null | undefined;
}

export function createSiteLabels(sites: SiteContext, ownOrigin: () => string, ask: LabelLookup): SiteLabels {
  const domain = siteDomainOf(sites);
  const key = fromBase64Url(sites.key);
  const root = parseUrl(sites.root);
  const protocol = root ? protocolOf(root) : "";
  const hosts = new NativeMap<string, string | null>();
  const lookups = new NativeMap<string, Promise<string | null>>();

  /** `origin` as a site host of this instance, with its label; another scheme could be anyone's server. */
  const siteHost = (origin: string): { origin: string; label: string } | null => {
    const url = parseUrl(origin);
    if (!url || protocolOf(url) !== protocol) return null;
    const kind = classifySiteHost(hostPart(url), domain);
    if (kind.kind !== "site") return null;
    return { __proto__: null, origin: originOf(url), label: kind.label } as { origin: string; label: string };
  };

  /** Callers ask only for origins `hostOf` cannot name, so a lookup kept here holds the worker's answer. */
  const resolve = (realOrigin: string): Promise<string | null> => {
    let lookup = apply(mapGet, lookups, [realOrigin]) as Promise<string | null> | undefined;
    if (!lookup) {
      lookup = new NativePromise<string | null>((settle) => {
        // A failed lookup is not kept, so the next message asks again.
        const finish = (found: unknown) => {
          const host = typeof found === "string" ? (siteHost(found)?.origin ?? null) : null;
          if (found === undefined) apply(mapDelete, lookups, [realOrigin]);
          else apply(mapSet, hosts, [realOrigin, host]);
          settle(host);
        };
        apply(promiseThen, ask(realOrigin), [finish, () => finish(undefined)]);
      });
      apply(mapSet, lookups, [realOrigin, lookup]);
    }
    return lookup;
  };

  return {
    hostOf: (realOrigin) => (apply(mapGet, hosts, [realOrigin]) as string | null | undefined) ?? null,
    resolve,
    envelope: (data, target) =>
      ({ __proto__: null, [MESSAGE_ENVELOPE]: 1, o: ownOrigin(), s: sites.site, t: target, d: data }) as never,
    verify: (nativeOrigin, value) => {
      const host = siteHost(nativeOrigin);
      if (!host || host.label === sites.label) return undefined;
      const envelope = readMessageEnvelope(value);
      if (!key || !envelope) return null;
      const place = placeIn(envelope.o, envelope.s);
      if (!place || siteLabel(key, envelope.s) !== host.label) return null;
      // A name under the site may sit under a public suffix and be a site of its own, which only the worker can tell.
      if (place === SAME) apply(mapSet, hosts, [envelope.o, host.origin]);
      const known = apply(mapGet, hosts, [envelope.o]) as string | null | undefined;
      if (known !== undefined && known !== host.origin) return null;
      return {
        __proto__: null,
        origin: envelope.o,
        target: envelope.t,
        data: envelope.d,
        host: host.origin,
        sure: known !== undefined,
      } as never;
    },
  };
}

/** classifySiteHost compares with the value alone, which the worker wrote already checked and lowercased. */
export function siteDomainOf(sites: SiteContext): SiteDomain {
  return { __proto__: null, value: sites.domain } as unknown as SiteDomain;
}

/**
 * The worker's label lookup for one origin, through the fetch taken before the page's network hooks. It settles with
 * a string or nothing, so no `then` a page put on a prototype is ever looked up.
 */
export function createLabelLookup(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  origin: string,
): LabelLookup {
  return (realOrigin) =>
    new NativePromise<string | null | undefined>((settle) => {
      const failed = () => settle(undefined);
      const read = (response: Response) =>
        apply(promiseThen, apply(responseText, response, []), [
          (text: string) => settle(hostIn(text, realOrigin)),
          failed,
        ]);
      // Written out from strings, so a page's JSON.stringify or toJSON never sees the origin.
      const body = `{"v":${PROTOCOL_VERSION},"origins":[${quoteJson(realOrigin)}]}`;
      try {
        apply(promiseThen, fetch(origin + LABEL_RPC_PATH, { __proto__: null, method: "POST", body } as never), [
          read,
          failed,
        ]);
      } catch {
        failed();
      }
    });
}

/** Where `origin`, a serialized web origin of `site`'s scheme, sits: on the site's own name, under it, or nowhere. */
function placeIn(origin: string, site: string): number {
  const claimed = parseUrl(origin);
  const own = parseUrl(site);
  if (!claimed || !own || !isWebUrl(claimed) || originOf(claimed) !== origin) return 0;
  if (protocolOf(claimed) !== protocolOf(own)) return 0;
  const host = urlPart(claimed, "hostname");
  const siteHost = urlPart(own, "hostname");
  return host === siteHost ? SAME : endsWith(host, `.${siteHost}`) ? UNDER : 0;
}

/** The host the worker named for `origin`, the answer's only entry: null for none, undefined if it does not say. */
function hostIn(text: string, origin: string): string | null | undefined {
  try {
    // A missing entry throws in ownValue; only own values are read, so prototypes play no part.
    const entry = ownValue(ownValue(parseJson(text) as object, "hosts") as object, 0) as object;
    const host = ownValue(entry, 1);
    if (ownValue(entry, 0) === origin) return typeof host === "string" ? host : null;
  } catch {
    // An answer of any other shape names nothing.
  }
  return undefined;
}
