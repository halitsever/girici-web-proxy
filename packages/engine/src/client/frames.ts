import { define, hrefOf, NativeWeakSet } from "../shared/primordials.ts";
import { PROTOCOL_VERSION, type ClientConfig, type CookieSnapshot } from "../shared/protocol.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentSteps } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import { openedOrigin, type WindowGuard } from "./windows.ts";

/** Gives a same-origin child window the runtime; windows that already carry one are left to renew themselves. */
export interface FrameAdopter {
  adopt(child: unknown, navigating?: boolean): void;
  /** Adopts every child window of this window. */
  walk(): void;
  /** Adopts every child window of the window that owns `target`, which may be another frame's document. */
  walkFor(target: unknown): void;
  /** Adds back the per-document listeners of a document that document.open cleared. */
  reopened(doc: unknown): void;
}

export interface FrameWalker {
  after<T>(mutate: () => T): T;
  walk(): void;
}

/** DOM methods that can connect an iframe, frame or object, and so create a child window synchronously. */
export const MUTATION_HOOKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Node", ["appendChild", "insertBefore", "replaceChild"]],
  ["Element", ["append", "prepend", "replaceChildren"]],
  ["Document", ["append", "prepend", "replaceChildren"]],
  ["DocumentFragment", ["append", "prepend", "replaceChildren"]],
  ["Element", ["before", "after", "replaceWith"]],
  ["CharacterData", ["before", "after", "replaceWith"]],
  ["DocumentType", ["before", "after", "replaceWith"]],
  ["Element", ["insertAdjacentElement"]],
  ["Range", ["insertNode", "surroundContents"]],
];

/** Setters that put a whole subtree, frames included, into a document. */
const SETTER_HOOKS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Document", ["body"]],
  ["HTMLTableElement", ["caption", "tHead", "tFoot"]],
];

const FRAME_ELEMENTS = ["HTMLIFrameElement", "HTMLFrameElement", "HTMLObjectElement"];
const SVG_DOCUMENT_ELEMENTS = ["HTMLIFrameElement", "HTMLObjectElement", "HTMLEmbedElement"];
const NO_CHILDREN: readonly unknown[] = [];
const PLUGIN_WALKS = [16, 50, 100, 250, 500, 1000, 2000];

// Taken at load: adoption runs inside page calls, after page code may have replaced these.
const apply = Reflect.apply;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const toText = String;
const then = Promise.prototype.then;
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const mapGet = WeakMap.prototype.get;
const mapSet = WeakMap.prototype.set;

/** Each adopted window's per-document reset after document.open, so a hook in another realm can reach it. */
const reopeners = new WeakMap<object, () => void>();

/**
 * Walks after a mutation only when the set of child windows changed, so the common insertion pays two reads of
 * `length`. A frame swapped for another keeps the count, so the children themselves are compared too.
 */
export function createFrameWalker(env: {
  length(): number;
  child(index: number): unknown;
  adopt(child: unknown): void;
}): FrameWalker {
  const children = (count: number): readonly unknown[] => {
    if (count === 0) return NO_CHILDREN;
    const list: unknown[] = [];
    for (let index = 0; index < count; index++) list[index] = env.child(index);
    return list;
  };
  const walk = () => {
    const count = env.length();
    for (let index = 0; index < count; index++) env.adopt(env.child(index));
  };
  return {
    walk,
    after<T>(mutate: () => T): T {
      const before = children(env.length());
      try {
        return mutate();
      } finally {
        const count = env.length();
        let changed = count !== before.length;
        for (let index = 0; !changed && index < count; index++) changed = env.child(index) !== before[index];
        if (changed) walk();
      }
    },
  };
}

/** The config a child window inherits, kept current as the browser hands this window new documents. */
export function createChildConfig(
  ctx: Pick<UrlContext, "origin" | "realUrl">,
  cookies: () => CookieSnapshot[],
  steps: DocumentSteps,
  initial: ClientConfig,
): () => ClientConfig {
  let current = initial;
  steps.add("child config", (next) => {
    current = next;
  });
  return () => {
    // Null prototypes, so setters or a toJSON a page put on Object.prototype never see or change the config.
    return {
      __proto__: null,
      v: PROTOCOL_VERSION,
      cookies: cookies(),
      inherit: { __proto__: null, origin: ctx.origin, base: hrefOf(ctx.realUrl()) },
      ...(current.cookiesBlocked !== undefined ? { cookiesBlocked: current.cookiesBlocked } : undefined),
      ...(current.site !== undefined ? { site: current.site } : undefined),
    } as ClientConfig;
  };
}

/** Same-origin child windows (frames, objects, popups) get the runtime before page code can reach them. */
export function installFrames(
  win: Realm,
  ctx: UrlContext,
  childConfig: () => ClientConfig,
  install: (win: Realm, config: ClientConfig, clientUrl: string, navigating?: boolean) => void,
  clientUrl: string,
  steps: DocumentSteps,
  guard: WindowGuard,
): FrameAdopter {
  const lengthOf = ownDescriptor(win, "length")?.get;
  const ownerDocument = ownDescriptor(win.Node.prototype, "ownerDocument")?.get;
  const defaultView = ownDescriptor(win.Document.prototype, "defaultView")?.get;
  const startContainer = win.Range ? ownDescriptor(win.Range.prototype, "startContainer")?.get : undefined;
  const addListener = win.EventTarget.prototype.addEventListener;
  // Cross-origin windows throw on every check, so walks skip them until the next frame load may have changed that.
  let crossOrigin = new NativeWeakSet<object>();

  /** Through the getter taken here, since a page can replace `length`; indexed access on a window cannot be. */
  const countOf = (view: object): number => {
    try {
      if (lengthOf) return apply(lengthOf, view, []) as number;
    } catch {
      // Another realm's getter may refuse this window; its own value is the fallback.
    }
    return (view as { length: number }).length;
  };

  const adopt = (child: unknown, navigating = false): void => {
    if (!child || child === win || apply(weakHas, crossOrigin, [child])) return;
    let carries: boolean;
    try {
      carries = ownDescriptor(child, "__g$") !== undefined;
    } catch {
      // A cross-origin window cannot reach this origin's storage.
      apply(weakAdd, crossOrigin, [child]);
      return;
    }
    // An adopted window is checked again each time: a frame can get a new document under the same window object.
    if (carries) return;
    try {
      install(child as Realm, childConfig(), clientUrl, navigating);
    } catch {
      // A window that closed meanwhile has nothing to install into.
    }
  };
  const walkView = (view: object) => {
    const count = countOf(view);
    for (let index = 0; index < count; index++) adopt((view as Record<number, unknown>)[index]);
  };
  const walker = createFrameWalker({
    length: () => countOf(win),
    child: (index) => (win as unknown as Record<number, unknown>)[index],
    adopt,
  });

  /** The window whose document holds `node`, or null for a document without one, where no frame can load. */
  const viewOf = (node: unknown): unknown => {
    try {
      if (!ownerDocument || !defaultView) return win;
      const owner = apply(ownerDocument, node, []) as unknown;
      return apply(defaultView, owner ?? node, []);
    } catch {
      return null;
    }
  };
  const viewOfRange = (range: unknown): unknown => {
    try {
      return startContainer ? viewOf(apply(startContainer, range, [])) : win;
    } catch {
      return null;
    }
  };
  /** Runs a mutation of the document in `view`, then adopts the windows it made there. */
  const mutateIn = <T>(view: unknown, mutate: () => T): T => {
    if (view === win) return walker.after(mutate);
    try {
      return mutate();
    } finally {
      // A node of another frame's document, changed with this realm's method, adds its children to that frame.
      if (view) walkView(view);
    }
  };
  const protoOf = (name: string) =>
    (win as unknown as Record<string, { prototype?: object } | undefined>)[name]?.prototype;

  for (const [name, methods] of MUTATION_HOOKS) {
    const proto = protoOf(name);
    if (!proto) continue;
    const targetView = name === "Range" ? viewOfRange : viewOf;
    for (const method of methods) {
      const descriptor = ownDescriptor(proto, method);
      const native = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (typeof native !== "function") continue;
      const hooked = function (this: unknown, ...args: unknown[]): unknown {
        return mutateIn(targetView(this), () => apply(native, this, args));
      };
      define(proto, method, { ...descriptor, value: maskNative(hooked, native) });
    }
  }
  for (const [name, properties] of SETTER_HOOKS) {
    const proto = protoOf(name);
    if (!proto) continue;
    for (const property of properties) {
      const descriptor = ownDescriptor(proto, property);
      const set = descriptor?.set;
      if (!set) continue;
      const hooked = function (this: unknown, value: unknown): void {
        mutateIn(viewOf(this), () => apply(set, this, [value]));
      };
      define(proto, property, { ...descriptor, set: maskNative(hooked, set) });
    }
  }

  const adoptDocument = (value: unknown) => {
    if (!value || !defaultView) return;
    try {
      adopt(apply(defaultView, value, []));
    } catch {
      // Not a document of this origin.
    }
  };
  /** Another origin's document stays out of reach, as the browser would keep it. */
  const visibleDocument = (value: unknown): unknown => {
    adoptDocument(value);
    if (!value || !defaultView) return value;
    try {
      return guard.isWrapper(guard.wrap(apply(defaultView, value, []))) ? null : value;
    } catch {
      return null;
    }
  };
  for (const name of FRAME_ELEMENTS) {
    const proto = protoOf(name);
    if (!proto) continue;
    for (const [property, settle] of [
      [
        "contentWindow",
        (value: unknown) => {
          adopt(value);
          return guard.wrap(value);
        },
      ],
      ["contentDocument", visibleDocument],
    ] as const) {
      const descriptor = ownDescriptor(proto, property);
      const get = descriptor?.get;
      if (!get) continue;
      const hooked = function (this: unknown): unknown {
        return settle(apply(get, this, []));
      };
      define(proto, property, { ...descriptor, get: maskNative(hooked, get) });
    }
  }
  for (const name of SVG_DOCUMENT_ELEMENTS) {
    const proto = protoOf(name);
    const descriptor = proto && ownDescriptor(proto, "getSVGDocument");
    const native = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
    if (!proto || typeof native !== "function") continue;
    const hooked = function (this: unknown): unknown {
      return visibleDocument(apply(native, this, []));
    };
    define(proto, "getSVGDocument", { ...descriptor, value: maskNative(hooked, native) });
  }

  const open = win.open;
  const openWindow = maskNative(function (this: unknown, ...args: unknown[]) {
    const opened = apply(open, this ?? win, args) as Window | null;
    // A popup opened with a URL keeps this blank window only until that page arrives and renews it.
    const url = args[0];
    adopt(opened, url !== undefined && url !== null && url !== "");
    return opened;
  }, open) as typeof win.open;
  win.open = openWindow;

  const reopenedFor = (doc: unknown) => {
    const view = viewOf(doc);
    const reopen =
      view === win ? reopened : view ? (apply(mapGet, reopeners, [view]) as (() => void) | undefined) : undefined;
    reopen?.();
  };
  hookDocumentOpen(
    win,
    (url, rest) => {
      // The three-argument form is window.open, which the navigation hook would otherwise never see.
      const proxied = url === undefined || url === null || url === "" ? url : ctx.toProxy(toText(url));
      return guard.wrap(apply(openWindow, win, [proxied, rest[0], rest[1]]), openedOrigin(proxied, ctx.origin));
    },
    reopenedFor,
  );
  hookPictureInPicture(win, adopt);

  // Backstops for windows no hook saw being made: parser-made frames, objects that load later, editing commands.
  const setTimer = win.setTimeout;
  const byTag = win.Document.prototype.getElementsByTagName;
  const collectionLength = ownDescriptor(win.HTMLCollection.prototype, "length")?.get;
  let plugins: object[] = [];
  let deferred = false;
  // An object or embed makes its window some tasks after insertion, and WebKit fires no event when its load fails,
  // so the walk is repeated for a while.
  const walkLater = () => {
    if (deferred) return;
    deferred = true;
    let index = 0;
    const next = () => {
      walker.walk();
      const delay = PLUGIN_WALKS[index++];
      if (delay === undefined) deferred = false;
      else apply(setTimer, win, [next, delay]);
    };
    apply(setTimer, win, [next, 0]);
  };
  const observer = new win.MutationObserver(() => {
    walker.walk();
    // Indexed, since a page can replace the array iterator.
    for (let index = 0; index < plugins.length; index++)
      if (collectionLength && apply(collectionLength, plugins[index], []) !== 0) walkLater();
  });
  const onLoad = () => {
    crossOrigin = new NativeWeakSet();
    walker.walk();
  };
  steps.add("frames observer", () => {
    const doc = win.document;
    plugins = [apply(byTag, doc, ["object"]) as object, apply(byTag, doc, ["embed"]) as object];
    observer.disconnect();
    observer.observe(doc, { childList: true, subtree: true });
    // On the document: a load event never travels up to the window, so a window listener would miss frame loads.
    // An object whose load fails fires error instead and may keep the blank window it made.
    apply(addListener, doc, ["load", onLoad, true]);
    apply(addListener, doc, ["error", onLoad, true]);
  });
  // document.open drops the document's and the window's listeners, so the per-document ones are added again.
  const reopened = () => steps.again(["frames observer", "listeners"]);
  apply(mapSet, reopeners, [win, reopened]);

  return {
    adopt,
    reopened: reopenedFor,
    walk: walker.walk,
    walkFor: (target) => {
      const view = viewOf(target);
      if (view === win) walker.walk();
      else if (view) walkView(view);
    },
  };
}

/** document.open with one or two arguments clears a document; with three it opens a window instead. */
function hookDocumentOpen(
  win: Realm,
  openWindow: (url: unknown, rest: unknown[]) => unknown,
  reopened: (doc: unknown) => void,
): void {
  const proto = win.Document.prototype;
  const descriptor = ownDescriptor(proto, "open");
  const native = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
  if (typeof native !== "function") return;
  const hooked = function (this: unknown, ...args: unknown[]): unknown {
    if (args.length >= 3) return openWindow(args[0], [args[1], args[2]]);
    const result = apply(native, this, args);
    reopened(this);
    return result;
  };
  define(proto, "open", { ...descriptor, value: maskNative(hooked, native) });
}

/** Chromium's Document Picture-in-Picture window shares this origin and starts blank. */
function hookPictureInPicture(win: Realm, adopt: (child: unknown) => void): void {
  const pip = (win as unknown as Record<string, { prototype?: object } | undefined>).DocumentPictureInPicture
    ?.prototype;
  if (!pip) return;
  const request = ownDescriptor(pip, "requestWindow");
  const native = request?.value as ((...args: unknown[]) => unknown) | undefined;
  if (typeof native === "function") {
    const hooked = function (this: unknown, ...args: unknown[]): unknown {
      // Chained here, so the window is adopted before the page's own continuation sees it.
      return apply(then, apply(native, this, args), [
        (opened: unknown) => {
          adopt(opened);
          return opened;
        },
      ]);
    };
    define(pip, "requestWindow", { ...request, value: maskNative(hooked, native) });
  }
  const event = (win as unknown as Record<string, { prototype?: object } | undefined>).DocumentPictureInPictureEvent
    ?.prototype;
  for (const proto of [pip, event]) {
    const current = proto && ownDescriptor(proto, "window");
    const get = current?.get;
    if (!proto || !get) continue;
    const hooked = function (this: unknown): unknown {
      const opened = apply(get, this, []);
      adopt(opened);
      return opened;
    };
    define(proto, "window", { ...current, get: maskNative(hooked, get) });
  }
}
