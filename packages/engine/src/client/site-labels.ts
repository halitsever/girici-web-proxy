/**
 * In subdomain mode another site's window lives on another host, so postMessage needs that host as its native target
 * and the receiver needs the sender's real origin back. Labels come from the config, verified messages and the worker.
 */

import {
  apply,
  endsWith,
  hostOf as hostPart,
  isArray,
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
  type LabelAnswer,
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
const mapHas = Map.prototype.has;
const mapDelete = Map.prototype.delete;
const setProto = Object.setPrototypeOf;
const responseText = Response.prototype.text;

type Hosts = LabelAnswer["hosts"];

export interface SiteLabels {
  /** The host serving `realOrigin`, when a lookup or a verified message has named it. */
  hostOf(realOrigin: string): string | null;
  resolve(realOrigin: string): Promise<string | null>;
  /** A site host of this instance other than this one. */
  isOtherSiteHost(origin: string): boolean;
  envelope(data: unknown, target: string): MessageEnvelope;
  /** The sender's real origin, its intended target and its data, when its site's label is its host's. */
  verify(nativeOrigin: string, value: unknown): { origin: string; target: string; data: unknown } | null;
}

export function createSiteLabels(
  sites: SiteContext,
  ownOrigin: () => string,
  ask: (origins: string[]) => Promise<Hosts>,
): SiteLabels {
  // classifySiteHost compares with the value alone, which the worker wrote already checked and lowercased.
  const domain = { __proto__: null, host: "", port: "", value: sites.domain } as SiteDomain;
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

  const resolve = (realOrigin: string): Promise<string | null> => {
    if (apply(mapHas, hosts, [realOrigin])) return settled(apply(mapGet, hosts, [realOrigin]) as string | null);
    const waiting = apply(mapGet, lookups, [realOrigin]) as Promise<string | null> | undefined;
    if (waiting) return waiting;
    let done: (host: string | null) => void = () => {};
    const lookup = new NativePromise<string | null>((settle) => {
      done = settle;
    });
    apply(mapSet, lookups, [realOrigin, lookup]);
    // A failed lookup is not kept, so the next message asks again.
    const finish = (host: string | null, keep: boolean) => {
      apply(mapDelete, lookups, [realOrigin]);
      if (keep) apply(mapSet, hosts, [realOrigin, host]);
      done(host);
    };
    const answered = (answer: Hosts) => {
      const found = answerFor(answer, realOrigin);
      if (found === undefined) finish(null, false);
      else finish(found === null ? null : (siteHost(found)?.origin ?? null), true);
    };
    try {
      apply(promiseThen, ask([realOrigin]), [answered, () => finish(null, false)]);
    } catch {
      finish(null, false);
    }
    return lookup;
  };

  return {
    hostOf: (realOrigin) => (apply(mapGet, hosts, [realOrigin]) as string | null | undefined) ?? null,
    resolve,
    isOtherSiteHost: (origin) => {
      const host = siteHost(origin);
      return host !== null && host.label !== sites.label;
    },
    envelope: (data, target) =>
      ({ __proto__: null, [MESSAGE_ENVELOPE]: 1, o: ownOrigin(), s: sites.site, t: target, d: data }) as never,
    verify: (nativeOrigin, value) => {
      const host = siteHost(nativeOrigin);
      const envelope = readMessageEnvelope(value);
      if (!host || host.label === sites.label || !key || !envelope) return null;
      if (!within(envelope.o, envelope.s) || siteLabel(key, envelope.s) !== host.label) return null;
      apply(mapSet, hosts, [envelope.o, host.origin]);
      return { __proto__: null, origin: envelope.o, target: envelope.t, data: envelope.d } as never;
    },
  };
}

/** The worker's label lookup, through the fetch taken before the page's network hooks. */
export function createLabelLookup(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  origin: string,
): (origins: string[]) => Promise<Hosts> {
  return (origins) =>
    new NativePromise<Hosts>((settle) => {
      // Written out from strings, so a page's JSON.stringify or toJSON never sees the origins.
      let body = `{"v":${PROTOCOL_VERSION},"origins":[`;
      for (let index = 0; index < origins.length; index++) {
        body += (index ? "," : "") + quoteJson(origins[index] as string);
      }
      const failed = () => settle(hostList([]));
      const read = (response: Response) =>
        apply(promiseThen, apply(responseText, response, []), [(text: string) => settle(readHosts(text)), failed]);
      try {
        const request = fetch(origin + LABEL_RPC_PATH, { __proto__: null, method: "POST", body: `${body}]}` } as never);
        apply(promiseThen, request, [read, failed]);
      } catch {
        failed();
      }
    });
}

/** `origin` is a serialized web origin of `site`'s scheme, on the site's host or under it. */
function within(origin: string, site: string): boolean {
  const claimed = parseUrl(origin);
  const own = parseUrl(site);
  if (!claimed || !own || !isWebUrl(claimed) || originOf(claimed) !== origin) return false;
  const host = urlPart(claimed, "hostname");
  const siteHost = urlPart(own, "hostname");
  return (
    protocolOf(claimed) === protocolOf(own) && siteHost !== "" && (host === siteHost || endsWith(host, `.${siteHost}`))
  );
}

/** The host named for `origin`: undefined when the answer has no entry for it. */
function answerFor(answer: Hosts, origin: string): string | null | undefined {
  if (!isArray(answer)) return undefined;
  for (let index = 0; index < answer.length; index++) {
    const entry = ownValue(answer, index);
    if (isArray(entry) && ownValue(entry, 0) === origin) {
      const host = ownValue(entry, 1);
      return typeof host === "string" ? host : null;
    }
  }
  return undefined;
}

/** The answer's list as sent; `answerFor` reads each entry. */
function readHosts(text: string): Hosts {
  try {
    const parsed = parseJson(text);
    const list = typeof parsed === "object" && parsed !== null ? ownValue(parsed, "hosts") : undefined;
    return hostList(isArray(list) ? list : []);
  } catch {
    return hostList([]);
  }
}

/** Without a prototype, so settling a promise with it never finds a `then` a page put on Array.prototype. */
function hostList(list: unknown[]): Hosts {
  return setProto(list, null) as Hosts;
}

function settled<T>(value: T): Promise<T> {
  return new NativePromise<T>((settle) => settle(value));
}
