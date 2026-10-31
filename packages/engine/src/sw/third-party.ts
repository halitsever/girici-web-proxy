import type { OpenSealed } from "../shared/sealed-address.ts";
import { schemefulSite } from "./cookies/policy.ts";
import { realUrlOf } from "./route.ts";
import type { WorkerIdentity } from "./worker-identity.ts";

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
  /** The page that started a worker, as it announced itself. */
  workers(clientId: string): Promise<WorkerIdentity | null>;
  /** Reads sealed page addresses. */
  open?: OpenSealed;
}

export interface TopSiteRequest {
  navigation: boolean;
  destination: RequestDestination;
  target: URL;
  referrer: string | null;
  resultingClientId: string;
  clientId: string;
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
  if (client?.type === "window") return windowTop(client, deps);
  const id = client?.id ?? request.clientId;
  // Chromium sends a nested worker's requests with no client, and those get no site, whatever their referrer says.
  if (!id) return null;
  // A worker shares the top site of the page that started it; one no page announced has none.
  return (await deps.workers(id))?.top ?? null;
}

/** The top site of a window client, top-level or nested. */
export async function windowTop(client: ClientInfo, deps: TopSiteDeps): Promise<string | null> {
  return TOP_FRAMES.has(client.frameType) ? siteOfProxied(client.url, deps) : nestedTop(client, deps);
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
  if (!parent) return { top: siteOfProxied(referrer, deps), known: false };
  const top = TOP_FRAMES.has(parent.frameType) ? siteOfProxied(parent.url, deps) : await nestedTop(parent, deps);
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

function siteOfProxied(url: string | null, deps: Pick<TopSiteDeps, "origin" | "open">): string | null {
  const real = realUrlOf(url, deps.origin, deps.open);
  return real ? schemefulSite(real) : null;
}
