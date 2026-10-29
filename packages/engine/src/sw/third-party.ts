import { schemefulSite } from "./cookies/policy.ts";
import { realUrlOf } from "./route.ts";

/** The parts of a Client this module reads, so tests can pass plain objects. */
export interface ClientInfo {
  id: string;
  type: string;
  frameType: string;
  url: string;
}

/** The top site each nested frame was opened under; bounded, since closed frames never say goodbye. */
export class FrameTops {
  readonly #limit: number;
  readonly #tops = new Map<string, string>();

  constructor(limit = 500) {
    this.#limit = limit;
  }

  get(clientId: string): string | undefined {
    return this.#tops.get(clientId);
  }

  set(clientId: string, topSite: string): void {
    this.#tops.delete(clientId);
    this.#tops.set(clientId, topSite);
    if (this.#tops.size <= this.#limit) return;
    const oldest = this.#tops.keys().next().value;
    if (oldest !== undefined) this.#tops.delete(oldest);
  }
}

export interface TopSiteDeps {
  frames: FrameTops;
  origin: string;
  windowClients(): Promise<readonly ClientInfo[]>;
  /** Asks a frame's runtime for the real URL of its top page, which it can read because every frame shares our origin. */
  askTop(clientId: string): Promise<string | null>;
}

export interface TopSiteRequest {
  navigation: boolean;
  destination: RequestDestination;
  target: URL;
  referrer: string | null;
  resultingClientId: string;
}

const TOP_FRAMES = new Set(["top-level", "auxiliary"]);

/** The schemeful site of the top-level page behind a request, or null when it cannot be told. */
export async function topSiteFor(
  request: TopSiteRequest,
  client: ClientInfo | undefined,
  deps: TopSiteDeps,
): Promise<string | null> {
  if (request.navigation) {
    if (request.destination === "document") return schemefulSite(request.target);
    // The worker sees no frame ancestry, so a new frame inherits its parent's top here, before its first request.
    const { top, known } = await parentTop(request.referrer, deps);
    if (top && known && request.resultingClientId) deps.frames.set(request.resultingClientId, top);
    return top;
  }
  if (!client) return siteOfProxied(request.referrer, deps.origin);
  if (client.type === "window") {
    return TOP_FRAMES.has(client.frameType) ? siteOfProxied(client.url, deps.origin) : nestedTop(client, deps);
  }
  return workerTop(request, client, deps);
}

/**
 * A worker counts as its own script's site. Page workers live on blob: addresses, so their runtime names the real
 * script, through the referrer of the fetches it makes or when asked; either answer is kept for the worker's
 * other requests, such as XHR.
 */
async function workerTop(request: TopSiteRequest, client: ClientInfo, deps: TopSiteDeps): Promise<string | null> {
  const own = siteOfProxied(client.url, deps.origin);
  if (own) return own;
  const known = deps.frames.get(client.id);
  if (known) return known;
  const named = siteOfProxied(request.referrer, deps.origin);
  if (!named) return nestedTop(client, deps);
  deps.frames.set(client.id, named);
  return named;
}

/** An unknown top counts as third-party: with blocking on, privacy wins. */
export function isThirdParty(target: URL, topSite: string | null): boolean {
  return topSite === null || schemefulSite(target) !== topSite;
}

async function parentTop(referrer: string | null, deps: TopSiteDeps): Promise<{ top: string | null; known: boolean }> {
  if (!referrer) return { top: null, known: false };
  // A referrer never carries the fragment that a client's address can.
  const wanted = withoutFragment(referrer);
  const parent = (await deps.windowClients()).find((client) => withoutFragment(client.url) === wanted);
  // The referrer alone is a guess, right for a top page and wrong for a nested one, so it is never remembered.
  if (!parent) return { top: siteOfProxied(referrer, deps.origin), known: false };
  const top = TOP_FRAMES.has(parent.frameType) ? siteOfProxied(parent.url, deps.origin) : await nestedTop(parent, deps);
  return { top, known: top !== null };
}

function withoutFragment(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

async function nestedTop(client: ClientInfo, deps: TopSiteDeps): Promise<string | null> {
  const known = deps.frames.get(client.id);
  if (known) return known;
  const answer = await deps.askTop(client.id);
  if (!answer) return null;
  let top: string;
  try {
    top = schemefulSite(new URL(answer));
  } catch {
    return null;
  }
  deps.frames.set(client.id, top);
  return top;
}

function siteOfProxied(url: string | null, origin: string): string | null {
  const real = realUrlOf(url, origin);
  return real ? schemefulSite(real) : null;
}
