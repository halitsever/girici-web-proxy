import type { ClientConfig } from "../shared/protocol.ts";
import { maskNative } from "./native-mask.ts";
import type { DocumentSteps } from "./renewal.ts";
import type { Realm, UrlContext } from "./url-context.ts";
import type { WindowGuard } from "./windows.ts";

/** Gives a same-origin child window the runtime; windows that already carry one are left to renew themselves. */
export interface FrameAdopter {
  adopt(child: unknown, navigating?: boolean): void;
  /** Adopts every child window of this window. */
  walk(): void;
  /** Adopts every child window of the window that owns `target`, which may be another frame's document. */
  walkFor(target: unknown): void;
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

const FRAME_ELEMENTS = ["HTMLIFrameElement", "HTMLFrameElement", "HTMLObjectElement"];
const SVG_DOCUMENT_ELEMENTS = ["HTMLIFrameElement", "HTMLObjectElement", "HTMLEmbedElement"];

// Taken at load: adoption runs inside page calls, after page code may have replaced these.
const apply = Reflect.apply;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;

/**
 * Walks after a mutation only when the set of child windows changed, so the common insertion pays two reads of
 * `length`. A frame swapped for another keeps the count, so the children themselves are compared too.
 */
export function createFrameWalker(env: {
  length(): number;
  child(index: number): unknown;
  adopt(child: unknown): void;
}): FrameWalker {
  const children = (count: number): unknown[] => {
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
    try {
      // A cross-origin window throws here and is skipped: it cannot reach this origin's storage.
      if (!child || child === win || ownDescriptor(child, "__g$")) return;
      install(child as Realm, childConfig(), clientUrl, navigating);
    } catch {
      // A window that closed or turned cross-origin meanwhile has nothing to install into.
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

  for (const [name, methods] of MUTATION_HOOKS) {
    const proto = (win as unknown as Record<string, { prototype?: object } | undefined>)[name]?.prototype;
    if (!proto) continue;
    const targetView = name === "Range" ? viewOfRange : viewOf;
    for (const method of methods) {
      const descriptor = ownDescriptor(proto, method);
      const native = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
      if (typeof native !== "function") continue;
      const hooked = function (this: unknown, ...args: unknown[]): unknown {
        const view = targetView(this);
        if (view === win) return walker.after(() => apply(native, this, args));
        try {
          return apply(native, this, args);
        } finally {
          // A node of another frame's document, inserted with this realm's method, adds a child to that frame.
          if (view) walkView(view);
        }
      };
      defineProperty(proto, method, { ...descriptor, value: maskNative(hooked, native) });
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
    const proto = (win as unknown as Record<string, { prototype?: object } | undefined>)[name]?.prototype;
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
      defineProperty(proto, property, { ...descriptor, get: maskNative(hooked, get) });
    }
  }
  for (const name of SVG_DOCUMENT_ELEMENTS) {
    const proto = (win as unknown as Record<string, { prototype?: object } | undefined>)[name]?.prototype;
    const descriptor = proto && ownDescriptor(proto, "getSVGDocument");
    const native = descriptor?.value as ((...args: unknown[]) => unknown) | undefined;
    if (!proto || typeof native !== "function") continue;
    const hooked = function (this: unknown): unknown {
      return visibleDocument(apply(native, this, []));
    };
    defineProperty(proto, "getSVGDocument", { ...descriptor, value: maskNative(hooked, native) });
  }

  const open = win.open;
  win.open = maskNative(function (this: unknown, ...args: unknown[]) {
    const opened = apply(open, this ?? win, args) as Window | null;
    // A popup opened with a URL keeps this blank window only until that page arrives and renews it.
    const url = args[0];
    adopt(opened, url !== undefined && url !== null && url !== "");
    return opened;
  }, open) as typeof win.open;

  // Backstops for windows no hook saw being made: parser-made frames, objects that load later, editing commands.
  const observer = new win.MutationObserver(() => walker.walk());
  const onLoad = () => walker.walk();
  steps.add("frames observer", () => {
    const doc = win.document;
    observer.disconnect();
    observer.observe(doc, { childList: true, subtree: true });
    // On the document: a load event never travels up to the window, so a window listener would miss frame loads.
    apply(addListener, doc, ["load", onLoad, true]);
  });

  return {
    adopt,
    walk: walker.walk,
    walkFor: (target) => {
      const view = viewOf(target);
      if (view === win) walker.walk();
      else if (view) walkView(view);
    },
  };
}
