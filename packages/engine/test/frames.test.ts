import { describe, expect, it } from "vitest";
import { createChildConfig, createFrameWalker, installFrames, MUTATION_HOOKS } from "../src/client/frames.ts";
import { DocumentSteps } from "../src/client/renewal.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import type { WindowGuard } from "../src/client/windows.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { DESCRIPTOR_ADDITIONS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

describe("createFrameWalker", () => {
  it("walks only when a mutation changed the number of child windows", () => {
    let count = 0;
    const adopted: unknown[] = [];
    const walker = createFrameWalker({ length: () => count, child: (i) => `w${i}`, adopt: (c) => adopted.push(c) });
    walker.after(() => undefined);
    expect(adopted).toEqual([]);
    walker.after(() => {
      count = 2;
    });
    expect(adopted).toEqual(["w0", "w1"]);
  });

  it("walks when a mutation swapped one child window for another", () => {
    let children = ["a"];
    const adopted: unknown[] = [];
    const walker = createFrameWalker({
      length: () => children.length,
      child: (i) => children[i],
      adopt: (c) => adopted.push(c),
    });
    walker.after(() => {
      children = ["b"];
    });
    expect(adopted).toEqual(["b"]);
  });

  it("walks after a mutation that threw part way", () => {
    let count = 0;
    const adopted: unknown[] = [];
    const walker = createFrameWalker({ length: () => count, child: (i) => i, adopt: (c) => adopted.push(c) });
    expect(() =>
      walker.after(() => {
        count = 1;
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(adopted).toEqual([0]);
  });

  it("returns what the mutation returned", () => {
    const walker = createFrameWalker({ length: () => 0, child: () => null, adopt: () => {} });
    expect(walker.after(() => 42)).toBe(42);
  });
});

interface FakeWindow {
  children: unknown[];
  document: object;
}

/** Gives a fake window the indexed children and `length` that installFrames reads. */
function asWindow<T extends object>(target: T, children: unknown[]): T & FakeWindow {
  // Read through `this`, as the browser's getter is, since installFrames applies one window's getter to others.
  Object.defineProperty(target, "length", {
    get(this: FakeWindow) {
      return this.children.length;
    },
  });
  for (let index = 0; index < 64; index++) Object.defineProperty(target, index, { get: () => children[index] });
  return Object.assign(target, { children, document: {} });
}

/** A realm with just the prototypes installFrames hooks; nodes name their window through ownerDocument. */
function fakeRealm() {
  const views = new Map<object, FakeWindow>();
  const added: unknown[] = [];
  const ctors: Record<string, { prototype: Record<string, unknown> }> = {};
  for (const name of [
    "Node",
    "Element",
    "Document",
    "DocumentFragment",
    "CharacterData",
    "DocumentType",
    "Range",
    "HTMLTableElement",
    "EventTarget",
  ])
    ctors[name] = { prototype: {} };
  const make = (target: object = {}): FakeWindow => {
    const view = asWindow(target, []);
    views.set(view.document, view);
    return view;
  };
  const node = (view: FakeWindow) => ({ owner: view.document });
  Object.defineProperty(ctors.Node!.prototype, "ownerDocument", {
    get(this: { owner?: object }) {
      return this.owner ?? null;
    },
  });
  Object.defineProperty(ctors.Document!.prototype, "defaultView", {
    get(this: object) {
      return views.get(this) ?? null;
    },
  });
  Object.defineProperty(ctors.Node!.prototype, "parentNode", {
    get(this: { parent?: unknown }) {
      return this.parent ?? null;
    },
  });
  Object.defineProperty(ctors.Node!.prototype, "nodeType", {
    get(this: { type?: number }) {
      return this.type ?? 1;
    },
  });
  // On AbstractRange, as browsers have it, not on Range itself.
  const abstractRange = {};
  Object.setPrototypeOf(ctors.Range!.prototype, abstractRange);
  Object.defineProperty(abstractRange, "startContainer", {
    get(this: { container: unknown }) {
      return this.container;
    },
  });
  // Every hooked method and setter adds a child window to the window owning its target.
  const calls: unknown[][] = [];
  const insert = function (this: { owner?: object; container?: { owner: object } }, ...args: unknown[]) {
    calls.push(args);
    const owner = this.owner ?? this.container?.owner;
    const view = owner ? views.get(owner) : undefined;
    const child = { name: `child${added.length}` };
    view?.children.push(child);
    added.push(child);
  };
  for (const [name, methods] of MUTATION_HOOKS) for (const method of methods) ctors[name]!.prototype[method] = insert;
  Object.defineProperty(ctors.Document!.prototype, "body", { configurable: true, set: insert });
  for (const property of ["caption", "tHead", "tFoot"])
    Object.defineProperty(ctors.HTMLTableElement!.prototype, property, { configurable: true, set: insert });
  ctors.Document!.prototype.open = () => undefined;
  ctors.Document!.prototype.getElementsByTagName = () => ({});
  ctors.HTMLCollection = { prototype: {} };
  Object.defineProperty(ctors.HTMLCollection.prototype, "length", { get: () => 0 });
  ctors.EventTarget!.prototype.addEventListener = () => undefined;
  const top = make({
    ...ctors,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    open: (url?: string) => ({ popup: url ?? "" }),
    setTimeout: () => 0,
  });
  // Like the browser's, the name setter is an own accessor of the window, and works on any window.
  Object.defineProperty(top, "name", {
    get(this: { windowName?: string }) {
      return this.windowName ?? "";
    },
    set(this: { windowName?: string }, value: string) {
      this.windowName = value;
    },
  });
  return { win: top as unknown as Realm, ctors, top, make, node, calls };
}

function setup(
  guard: WindowGuard = { wrap: (value) => value, isWrapper: () => false, reset: () => {} },
  toProxy = (raw: string) => `/~/${raw.replace("://", "/")}`,
  around: <T>(install: () => T) => T = (install) => install(),
  open?: (...args: unknown[]) => unknown,
  base = new URL("https://a.test/page"),
) {
  const realm = fakeRealm();
  if (open) (realm.top as unknown as { open: unknown }).open = open;
  const installed: Array<{ child: unknown; navigating: boolean | undefined }> = [];
  const steps = new DocumentSteps();
  const assigned: string[] = [];
  const ctx = {
    origin: "http://proxy.test",
    toProxy,
    realUrl: () => new URL("https://a.test/page"),
    realBase: () => base,
  } as unknown as UrlContext;
  const adopter = around(() =>
    installFrames(
      realm.win,
      ctx,
      () => ({ v: PROTOCOL_VERSION, cookies: [] }),
      (child, _config, _url, navigating) => {
        Object.defineProperty(child, "__g$", { value: {} });
        installed.push({ child, navigating });
      },
      "",
      steps,
      guard,
      (location, url) => {
        assigned.push(url);
        (location as { href: string }).href = url;
        return true;
      },
    ),
  );
  return { ...realm, installed, adopter, steps, assigned };
}

/**
 * A window.open over named windows, as the browser keeps them: an existing name gives its window back, renaming a
 * window frees its name. Each window shows about:blank and records where it was sent. Once `blocked`, no new window
 * is made, as under a popup blocker.
 */
function namedWindows() {
  const windows: Array<Record<string, unknown>> = [];
  const calls: unknown[][] = [];
  const state = { blocked: false };
  const make = (name: string) => {
    const sent: string[] = [];
    const location = {};
    Object.defineProperty(location, "href", { get: () => "about:blank", set: (url: string) => sent.push(url) });
    const made = { windowName: name, location, sent };
    windows.push(made);
    return made;
  };
  const open = (...args: unknown[]) => {
    const [url, target] = args as [string, string | undefined];
    calls.push([url, target]);
    const name = target === undefined || target === "_blank" ? "" : target;
    return (name && windows.find((candidate) => candidate.windowName === name)) || (state.blocked ? null : make(name));
  };
  return { open, calls, windows, make, state };
}

/** A window.open that records its calls and hands out windows whose location records where it was sent. */
function recordingOpen(shows = "about:blank") {
  const calls: unknown[][] = [];
  const sent: string[] = [];
  const location = {};
  Object.defineProperty(location, "href", {
    get: () => shows,
    set: (url: string) => sent.push(url),
  });
  const opened = { location };
  const open = (...args: unknown[]) => {
    calls.push(args);
    return opened;
  };
  return { open, calls, sent };
}

describe("installFrames", () => {
  it("hooks every insertion method and setter on its own prototype", () => {
    const { ctors, top, node, installed } = setup();
    const target = node(top);
    for (const [name, methods] of MUTATION_HOOKS) {
      for (const method of methods) {
        const self = name === "Range" ? { container: target } : target;
        (ctors[name]!.prototype[method] as (this: unknown) => void).call(self);
      }
    }
    const setters: Array<[string, string]> = [
      ["Document", "body"],
      ["HTMLTableElement", "caption"],
      ["HTMLTableElement", "tHead"],
      ["HTMLTableElement", "tFoot"],
    ];
    for (const [name, property] of setters) Reflect.set(ctors[name]!.prototype, property, 1, target);
    const count = MUTATION_HOOKS.reduce((sum, [, methods]) => sum + methods.length, 0) + setters.length;
    expect(installed.map((entry) => entry.child)).toEqual(top.children);
    expect(installed).toHaveLength(count);
  });

  it("hooks every insertion method when the page replaced the array iterator before adoption", () => {
    const { ctors, top, node, installed } = setup(undefined, undefined, (install) =>
      withReplaced(Array.prototype, Symbol.iterator, { value: function* () {} }, install),
    );
    (ctors.Node!.prototype.appendChild as (this: unknown) => void).call(node(top));
    expect(installed.map((entry) => entry.child)).toEqual(top.children);
    expect(installed.length).toBeGreaterThan(0);
  });

  it("hands the nodes each insertion adds to every backstop before the native insertion", () => {
    const { ctors, top, node, adopter } = setup();
    const target = node(top);
    const seen: unknown[][] = [];
    const order: string[] = [];
    adopter.addBackstop((nodes) => {
      seen.push([...nodes]);
      order.push(`first:${top.children.length}`);
    });
    adopter.addBackstop(() => order.push("second"));
    const inserted = { inserted: true };
    const reference = { reference: true };
    const call = (name: string, method: string, self: unknown, ...args: unknown[]) =>
      (ctors[name]!.prototype[method] as (this: unknown, ...args: unknown[]) => void).call(self, ...args);
    call("Node", "appendChild", target, inserted);
    call("Node", "insertBefore", target, inserted, reference);
    call("Node", "replaceChild", target, inserted, reference);
    call("Element", "append", target, inserted, "text");
    call("Element", "insertAdjacentElement", target, "beforeend", inserted);
    call("Range", "insertNode", { container: target }, inserted);
    Reflect.set(ctors.Document!.prototype, "body", inserted, target);
    expect(seen).toEqual([[inserted], [inserted], [inserted], [inserted, "text"], [inserted], [inserted], [inserted]]);
    expect(order.slice(0, 2)).toEqual(["first:0", "second"]);
  });

  it("names the node each insertion goes into", () => {
    const { ctors, top, node, adopter } = setup();
    const parent = node(top);
    const element = { ...node(top), parent };
    const text = { ...node(top), parent: element, type: 3 };
    const seen: unknown[] = [];
    adopter.addBackstop((_nodes, target) => seen.push(target));
    const call = (name: string, method: string, self: unknown, ...args: unknown[]) =>
      (ctors[name]!.prototype[method] as (this: unknown, ...args: unknown[]) => void).call(self, ...args);
    call("Element", "append", element, "a");
    for (const method of ["before", "after", "replaceWith"]) {
      call("Element", method, element, "a");
      call("CharacterData", method, text, "a");
    }
    call("Element", "insertAdjacentElement", element, "beforeBegin", {});
    call("Element", "insertAdjacentElement", element, "afterbegin", {});
    call("Range", "insertNode", { container: element }, {});
    call("Range", "insertNode", { container: text }, {});
    Reflect.set(ctors.HTMLTableElement!.prototype, "caption", {}, element);
    expect(seen).toEqual([
      element,
      parent,
      element,
      parent,
      element,
      parent,
      element,
      parent,
      element,
      element,
      element,
      element,
    ]);
  });

  it("inserts what a backstop put in place of a string", () => {
    const { ctors, top, node, adopter, calls } = setup();
    adopter.addBackstop((nodes) => {
      if (nodes[0] === "code") nodes[0] = "rewritten";
    });
    (ctors.Element!.prototype.replaceChildren as (this: unknown, ...args: unknown[]) => void).call(node(top), "code");
    expect(calls.at(-1)).toEqual(["rewritten"]);
  });

  it("adopts the children a mutation adds to another frame's document", () => {
    const { ctors, make, node, installed, adopter } = setup();
    const other = make();
    (ctors.Node!.prototype.appendChild as (this: unknown) => void).call(node(other));
    expect(installed.map((entry) => entry.child)).toEqual(other.children);
    other.children.push({ name: "late" });
    adopter.walkFor(node(other));
    expect(installed.map((entry) => entry.child)).toEqual(other.children);
  });

  it("tells a popup opened with a URL that its blank window is about to be replaced", () => {
    const { win, installed } = setup();
    win.open("/~/https/a.test/next");
    win.open();
    expect(installed.map((entry) => entry.navigating)).toEqual([true, false]);
  });

  it("sends another origin's page to a blank popup, whose first page gets a window of its own", () => {
    const { open, calls, sent } = recordingOpen();
    const { win, installed, assigned } = setup(undefined, undefined, undefined, open);
    const opened = win.open("/~/https/b.test/x", "named", "popup");
    expect(calls).toEqual([["", "named", "popup"]]);
    // Assigned from the page's own realm, which makes it the navigation's source.
    expect(assigned).toEqual(["/~/https/b.test/x"]);
    expect(sent).toEqual(["/~/https/b.test/x"]);
    expect(installed).toEqual([{ child: opened, navigating: true }]);
  });

  it("keeps the browser's own open for this origin's pages, the page's own window and severed popups", () => {
    const { open, calls, sent } = recordingOpen();
    const { win } = setup(undefined, undefined, undefined, open);
    win.open("/~/https/a.test/next");
    win.open("/~/https/b.test/x", "_SELF");
    win.open("/~/https/b.test/x", "_top");
    win.open("/~/https/b.test/x", "_blank", "noopener");
    win.open("/~/https/b.test/x", "", "width=200,NoReferrer");
    win.open("");
    expect(calls).toEqual([
      ["/~/https/a.test/next", undefined, undefined],
      ["/~/https/b.test/x", "_SELF", undefined],
      ["/~/https/b.test/x", "_top", undefined],
      ["/~/https/b.test/x", "_blank", "noopener"],
      ["/~/https/b.test/x", "", "width=200,NoReferrer"],
      ["", undefined, undefined],
    ]);
    expect(sent).toEqual([]);
  });

  it("leaves a named window that already shows a page to the browser's own open, which keeps its history", () => {
    const { open, calls, sent } = recordingOpen("http://proxy.test/~/https/a.test/idle");
    const { win, installed } = setup(undefined, undefined, undefined, open);
    win.open("/~/https/b.test/x", "named");
    expect(calls).toEqual([
      ["", "named", undefined],
      ["/~/https/b.test/x", "named", undefined],
    ]);
    expect(sent).toEqual([]);
    expect(installed).toEqual([]);
  });

  it("sends a javascript: URL, or any address that is no page of this origin, to a window opened blank", () => {
    const { open, calls, sent } = recordingOpen();
    const { win, assigned } = setup(undefined, undefined, undefined, open);
    win.open("javascript:void 0", "j");
    win.open("about:blank#x");
    win.open("/~/https/b.test/x", "", "noopener=0");
    win.open("/~/https/b.test/x", "", "xnoopener");
    expect(calls).toEqual([
      ["", "j", undefined],
      ["", undefined, undefined],
      ["", "", "noopener=0"],
      ["", "", "xnoopener"],
    ]);
    expect(assigned).toEqual(["javascript:void 0", "about:blank#x", "/~/https/b.test/x", "/~/https/b.test/x"]);
    expect(sent).toEqual(assigned);
  });

  it("reads each argument once and hands the browser the same text", () => {
    const { open, calls } = recordingOpen();
    const { win } = setup(undefined, undefined, undefined, open);
    let reads = 0;
    const once = (text: string) => ({
      toString: () => {
        reads++;
        return text;
      },
    });
    win.open(once("/~/https/a.test/next") as never, once("_self") as never, once("popup") as never);
    expect(reads).toBe(3);
    expect(calls).toEqual([["/~/https/a.test/next", "_self", "popup"]]);
  });

  it("resolves a relative address against the document's own base, another site's included", () => {
    const { open, calls } = recordingOpen();
    const { win, assigned } = setup(undefined, undefined, undefined, open, new URL("https://c.test/dir/"));
    win.open("page", "r");
    expect(calls).toEqual([["", "r", undefined]]);
    expect(assigned).toEqual(["page"]);
  });

  it("sends another origin's page to a fresh window when the named one is a blank window the browser would keep", () => {
    const named = namedWindows();
    const { win, assigned } = setup(undefined, undefined, undefined, named.open);
    // Opened with an address of this origin, still blank: the browser keeps it for whichever page arrives first.
    const kept = win.open("/~/https/a.test/idle", "r") as unknown as Record<string, unknown>;
    const sent = win.open("/~/https/b.test/x", "r") as unknown as Record<string, unknown>;
    expect(sent).not.toBe(kept);
    expect([kept.windowName, sent.windowName]).toEqual(["", "r"]);
    expect(assigned).toEqual(["/~/https/b.test/x"]);
    expect(Object.getOwnPropertyDescriptor(kept, "__g$made")).toMatchObject({ value: "url", configurable: false });
    expect(Object.getOwnPropertyDescriptor(sent, "__g$made")).toMatchObject({ value: "blank", configurable: false });
    expect(Object.getOwnPropertyDescriptor(sent, "__g$to")).toMatchObject({
      value: "https://b.test",
      configurable: false,
    });
    // A window this engine opened blank is never kept, so the page's own handle stays the one the page is sent to.
    const blank = win.open("", "s");
    expect(win.open("/~/https/b.test/y", "s")).toBe(blank);
  });

  it("counts an adopted window it did not open as one the browser may keep", () => {
    const named = namedWindows();
    const frame = named.make("f");
    Object.defineProperty(frame, "__g$", { value: {} });
    const { win } = setup(undefined, undefined, undefined, named.open);
    expect(win.open("/~/https/b.test/x", "f")).not.toBe(frame);
    expect(frame.windowName).toBe("");
  });

  it("leaves the name on the kept window when the browser blocks the fresh one", () => {
    const named = namedWindows();
    const { win } = setup(undefined, undefined, undefined, named.open);
    const kept = win.open("/~/https/a.test/idle", "r") as unknown as Record<string, unknown>;
    named.state.blocked = true;
    expect(win.open("/~/https/b.test/x", "r")).toBeNull();
    expect(kept.windowName).toBe("r");
    expect(kept.sent).toEqual([]);
  });

  it("counts any own mark, an accessor included, as a window the browser may keep", () => {
    const named = namedWindows();
    const forged = named.make("g");
    Object.defineProperty(forged, "__g$made", { get: () => "blank" });
    const { win } = setup(undefined, undefined, undefined, named.open);
    expect(win.open("/~/https/b.test/x", "g")).not.toBe(forged);
    expect(forged.windowName).toBe("");
    expect(forged.sent).toEqual([]);
  });

  it("readies the window a link or form names before the browser makes it with an address", () => {
    const named = namedWindows();
    const { win, adopter, installed } = setup(undefined, undefined, undefined, named.open);
    adopter.prepareTarget("_blank", "https://b.test");
    adopter.prepareTarget("fresh", "https://b.test");
    expect(named.calls).toEqual([["", "fresh"]]);
    const fresh = named.windows[0] as Record<string, unknown>;
    expect(Object.getOwnPropertyDescriptor(fresh, "__g$made")?.value).toBe("blank");
    expect(Object.getOwnPropertyDescriptor(fresh, "__g$to")?.value).toBe("https://b.test");
    expect(installed.map((entry) => entry.child)).toEqual([fresh]);
    // A blank window the browser would keep is swapped for a fresh one under its name.
    const kept = win.open("/~/https/a.test/idle", "k") as unknown as Record<string, unknown>;
    adopter.prepareTarget("k", "https://b.test");
    expect(kept.windowName).toBe("");
    expect(named.windows.filter((candidate) => candidate.windowName === "k")).toHaveLength(1);
  });

  it("returns what a blocked popup returns without sending anything", () => {
    const { win, installed } = setup(undefined, undefined, undefined, () => null);
    expect(win.open("/~/https/b.test/x")).toBeNull();
    expect(installed).toEqual([]);
  });

  it("opens a window for document.open with three arguments, through the proxy", () => {
    const { win, ctors, installed } = setup();
    (ctors.Document!.prototype.open as (...args: unknown[]) => unknown).call(win.document, "https://a.test/n", "n", "");
    expect(installed).toEqual([{ child: { popup: "/~/https/a.test/n" }, navigating: true }]);
  });

  it("opens through the navigation layer's open once there is one, with the page's own arguments", () => {
    const { win, ctors, adopter } = setup();
    const calls: unknown[][] = [];
    adopter.useOpen(function (this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
      return "opened";
    } as never);
    const open = ctors.Document!.prototype.open as (...args: unknown[]) => unknown;
    expect(open.call(win.document, "blob:http://p.test/1", "_self", "")).toBe("opened");
    expect(calls).toEqual([[win, "blob:http://p.test/1", "_self", ""]]);
  });

  it("hands the window document.open opens to the guard, with the origin it is headed to", () => {
    const wrapped: Array<[unknown, string | undefined]> = [];
    const guard: WindowGuard = {
      wrap: (value, headedTo) => {
        wrapped.push([value, headedTo]);
        return "wrapper";
      },
      isWrapper: () => false,
      reset: () => {},
    };
    const { win, ctors } = setup(guard, () => "/~/https/x.test/");
    const open = ctors.Document!.prototype.open as (...args: unknown[]) => unknown;
    expect(open.call(win.document, "https://x.test/", "n", "")).toBe("wrapper");
    expect(wrapped).toEqual([[{ popup: "/~/https/x.test/" }, "https://x.test"]]);
  });

  it("listens again after document.open clears the document", () => {
    const { win, ctors, steps } = setup();
    const seen: string[] = [];
    steps.add("listeners", () => seen.push("listeners"));
    steps.add("cookies", () => seen.push("cookies"));
    steps.run({ v: PROTOCOL_VERSION, cookies: [] });
    (ctors.Document!.prototype.open as (this: unknown) => unknown).call(win.document);
    expect(seen).toEqual(["listeners", "cookies", "listeners"]);
  });
});

describe("with page additions to Object.prototype", () => {
  it("still hooks a child realm's prototypes", () => {
    const { win, ctors, installed } = withPrototypeAdditions(DESCRIPTOR_ADDITIONS, () => setup());
    (ctors.Document!.prototype.open as (...args: unknown[]) => unknown).call(win.document, "https://a.test/n", "n", "");
    expect(installed).toEqual([{ child: { popup: "/~/https/a.test/n" }, navigating: true }]);
  });

  it("keeps a child's config fields when setters for them sit on Object.prototype", () => {
    const steps = new DocumentSteps();
    const ctx = { origin: "http://proxy.test", realUrl: () => new URL("https://a.test/") };
    const initial = { v: PROTOCOL_VERSION, cookies: [], site: "https://a.test", cookiesBlocked: true };
    const childConfig = createChildConfig(ctx, () => [], steps, initial);
    const swallow = { set: () => {} };
    const child = withPrototypeAdditions({ site: swallow, cookiesBlocked: swallow, inherit: swallow }, childConfig);
    expect(Object.getOwnPropertyNames(child).sort()).toEqual(["cookies", "cookiesBlocked", "inherit", "site", "v"]);
    expect(JSON.parse(JSON.stringify(child))).toMatchObject({ site: "https://a.test", cookiesBlocked: true });
  });
});

describe("createChildConfig", () => {
  it("gives frames of a renewed document that document's config", () => {
    const steps = new DocumentSteps();
    let real = new URL("https://a.test/");
    const ctx = { origin: "http://proxy.test", realUrl: () => real };
    const childConfig = createChildConfig(ctx, () => [], steps, {
      v: PROTOCOL_VERSION,
      cookies: [],
      site: "https://a.test",
    });
    steps.run({ v: PROTOCOL_VERSION, cookies: [], site: "https://a.test" });
    real = new URL("https://b.test/x");
    steps.run({ v: PROTOCOL_VERSION, cookies: [], site: "https://b.test", cookiesBlocked: true });
    expect(childConfig()).toEqual({
      v: PROTOCOL_VERSION,
      cookies: [],
      site: "https://b.test",
      cookiesBlocked: true,
      inherit: { origin: "http://proxy.test", base: "https://b.test/x" },
    });
  });
});
