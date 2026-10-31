import { describe, expect, it } from "vitest";
import { createChildConfig, createFrameWalker, installFrames, MUTATION_HOOKS } from "../src/client/frames.ts";
import { DocumentSteps } from "../src/client/renewal.ts";
import type { Realm, UrlContext } from "../src/client/url-context.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";

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
  Object.defineProperty(ctors.Range!.prototype, "startContainer", {
    get(this: { container: unknown }) {
      return this.container;
    },
  });
  // Every hooked method and setter adds a child window to the window owning its target.
  const insert = function (this: { owner?: object; container?: { owner: object } }) {
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
  return { win: top as unknown as Realm, ctors, top, make, node };
}

function setup() {
  const realm = fakeRealm();
  const installed: Array<{ child: unknown; navigating: boolean | undefined }> = [];
  const steps = new DocumentSteps();
  const ctx = { origin: "http://proxy.test", toProxy: (raw: string) => `/~/${raw}` } as unknown as UrlContext;
  const adopter = installFrames(
    realm.win,
    ctx,
    () => ({ v: PROTOCOL_VERSION, cookies: [] }),
    (child, _config, _url, navigating) => {
      Object.defineProperty(child, "__g$", { value: {} });
      installed.push({ child, navigating });
    },
    "",
    steps,
  );
  return { ...realm, installed, adopter, steps };
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
    win.open("https://x.test/");
    win.open();
    expect(installed.map((entry) => entry.navigating)).toEqual([true, false]);
  });

  it("opens a window for document.open with three arguments, through the proxy", () => {
    const { win, ctors, installed } = setup();
    (ctors.Document!.prototype.open as (...args: unknown[]) => unknown).call(win.document, "https://x.test/", "n", "");
    expect(installed).toEqual([{ child: { popup: "/~/https://x.test/" }, navigating: true }]);
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
