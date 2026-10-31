import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCurrentScript,
  createRenew,
  DocumentSteps,
  engineScriptConfig,
  renewExisting,
} from "../src/client/renewal.ts";
import { install } from "../src/client/runtime.ts";
import type { Realm } from "../src/client/url-context.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";
import { PROTOCOL_VERSION, type ClientConfig } from "../src/shared/protocol.ts";

const origin = "http://p.test";
const config = JSON.stringify({ v: PROTOCOL_VERSION, cookies: [] });
const engineSrc = `${origin}/_g/client.AB12CD34.js`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engineScriptConfig", () => {
  it("reads a config only from the engine's own script", () => {
    expect(engineScriptConfig({ src: engineSrc, config }, origin)).toEqual({
      v: PROTOCOL_VERSION,
      cookies: [],
    });
    for (const src of [
      `${origin}/~/https/a.test/_g/client.AB12CD34.js`,
      "http://evil.test/_g/client.AB12CD34.js",
      `${origin}/_g/worker.AB12CD34.js`,
    ])
      expect(engineScriptConfig({ src, config }, origin), src).toBeNull();
    expect(engineScriptConfig({ src: engineSrc, config: '{"v":1,"cookies":[]}' }, origin)).toBeNull();
    expect(engineScriptConfig(null, origin)).toBeNull();
  });

  for (const [name, target, key, replacement] of [
    ...REPLACED_BUILTINS,
    ["RegExp.prototype.test", RegExp.prototype, "test", { value: () => true }],
    ["JSON.parse", JSON, "parse", { value: () => ({ v: PROTOCOL_VERSION, cookies: [], site: "https://evil.test" }) }],
  ] as Array<[string, object, PropertyKey, PropertyDescriptor]>) {
    it(`tells the engine's script apart when ${name} is replaced`, () => {
      const pageSrc = `${origin}/~/https/a.test/_g/client.AB12CD34.js`;
      const read = () => [
        engineScriptConfig({ src: engineSrc, config }, origin),
        engineScriptConfig({ src: pageSrc, config }, origin),
      ];
      expect(withReplaced(target, key, replacement, read)).toEqual([{ v: PROTOCOL_VERSION, cookies: [] }, null]);
    });
  }

  it("refuses a missing or broken config instead of starting from an empty one", () => {
    for (const broken of [null, "", "junk", "{}", '{"v":2}', "null"])
      expect(engineScriptConfig({ src: engineSrc, config: broken }, origin), String(broken)).toBeNull();
  });
});

describe("DocumentSteps", () => {
  it("runs every document step again with the new config, past a failing one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: string[] = [];
    const steps = new DocumentSteps();
    steps.add("broken", () => {
      throw new Error("x");
    });
    steps.add("record", (c) => seen.push(c.site ?? ""));
    steps.run({ v: 2, cookies: [], site: "https://a.test" });
    steps.run({ v: 2, cookies: [], site: "https://b.test" });
    expect(seen).toEqual(["https://a.test", "https://b.test"]);
  });

  it("keeps every step when the page replaced Array.prototype.push", () => {
    const seen: string[] = [];
    const steps = withReplaced(Array.prototype, "push", { value: () => 0 }, () => {
      const made = new DocumentSteps();
      made.add("listeners", () => {
        seen[seen.length] = "listeners";
      });
      return made;
    });
    steps.run({ v: 2, cookies: [] });
    expect(seen).toEqual(["listeners"]);
  });

  it("runs the named steps again when the page replaced the array iterator and includes", () => {
    const seen: string[] = [];
    const steps = new DocumentSteps();
    steps.add("listeners", () => seen.push("listeners"));
    steps.add("cookies", () => seen.push("cookies"));
    steps.run({ v: 2, cookies: [] });
    withReplaced(Array.prototype, Symbol.iterator, { value: [][Symbol.iterator].bind([]) }, () =>
      withReplaced(Array.prototype, "includes", { value: () => false }, () => steps.again(["listeners"])),
    );
    expect(seen).toEqual(["listeners", "cookies", "listeners"]);
  });
});

interface FakeScript {
  src_?: string;
  attrs_: Record<string, string>;
}

/** A realm whose current script and its getters can be swapped after capture, as page code could. */
function scriptRealm(script: FakeScript | null) {
  const Document = { prototype: {} };
  const HTMLScriptElement = { prototype: {} };
  const Element = { prototype: {} as Record<string, unknown> };
  const document = Object.create(Document.prototype) as object;
  Object.defineProperty(Document.prototype, "currentScript", { configurable: true, get: () => script });
  Object.defineProperty(HTMLScriptElement.prototype, "src", {
    configurable: true,
    get(this: FakeScript) {
      if (this.src_ === undefined) throw new TypeError("not an HTML script");
      return this.src_;
    },
  });
  Element.prototype.getAttribute = function (this: FakeScript, name: string) {
    return this.attrs_[name] ?? null;
  };
  return { win: { document, Document, HTMLScriptElement, Element } as unknown as Realm, Document, Element };
}

describe("captureCurrentScript", () => {
  const engine: FakeScript = { src_: engineSrc, attrs_: { "data-girici": config } };

  it("reads the script through the natives it took at capture", () => {
    const { win, Document, Element } = scriptRealm(engine);
    const read = captureCurrentScript(win);
    Object.defineProperty(Document.prototype, "currentScript", { get: () => ({ src_: "x", attrs_: {} }) });
    Element.prototype.getAttribute = () => "forged";
    const call = Function.prototype.call;
    Function.prototype.call = () => {
      throw new Error("looked up at call time");
    };
    let script: ReturnType<typeof read>;
    try {
      script = read();
    } finally {
      Function.prototype.call = call;
    }
    expect(script).toEqual({ src: engineSrc, config });
  });

  it("reports no script for an SVG script or none at all", () => {
    expect(captureCurrentScript(scriptRealm({ attrs_: {} }).win)()).toBeNull();
    expect(captureCurrentScript(scriptRealm(null).win)()).toBeNull();
  });
});

describe("createRenew", () => {
  const next: ClientConfig = { v: PROTOCOL_VERSION, cookies: [], site: "https://b.test" };

  function recorded() {
    const seen: ClientConfig[] = [];
    const steps = new DocumentSteps();
    steps.add("record", (value) => seen.push(value));
    return { seen, steps };
  }

  it("runs the document steps with the config of the engine's own script", () => {
    const { seen, steps } = recorded();
    expect(createRenew(() => ({ src: engineSrc, config: JSON.stringify(next) }), origin, steps)()).toBe(true);
    expect(seen).toEqual([next]);
  });

  it("leaves the document steps alone for any other script", () => {
    const { seen, steps } = recorded();
    const pageSrc = `${origin}/~/https/a.test/_g/client.AB12CD34.js`;
    expect(createRenew(() => ({ src: pageSrc, config: JSON.stringify(next) }), origin, steps)()).toBe(false);
    expect(createRenew(() => ({ src: engineSrc, config: "junk" }), origin, steps)()).toBe(false);
    expect(createRenew(() => null, origin, steps)()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("leaves the document steps alone for a config the window refuses", () => {
    const { seen, steps } = recorded();
    const script = () => ({ src: engineSrc, config: JSON.stringify(next) });
    expect(createRenew(script, origin, steps, (value) => value.site !== "https://b.test")()).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe("renewExisting", () => {
  it("reloads when the runtime already in the window cannot take this document", () => {
    const cases: Array<[string, unknown, number]> = [
      ["renewed", { renew: () => true }, 0],
      ["refused", { renew: () => false }, 1],
      ["older runtime", {}, 1],
      ["no helpers", undefined, 1],
      [
        "threw",
        {
          renew: () => {
            throw new Error("x");
          },
        },
        1,
      ],
    ];
    for (const [name, helpers, reloads] of cases) {
      const reload = vi.fn();
      renewExisting(helpers, reload);
      expect(reload, name).toHaveBeenCalledTimes(reloads);
    }
  });
});

describe("install", () => {
  const initial: ClientConfig = { v: PROTOCOL_VERSION, cookies: [] };

  function reusedWindow(renew: unknown) {
    const reload = vi.fn();
    const location = { reload };
    const win = { location } as unknown as Realm;
    Object.defineProperty(win, "__g$", { value: { renew } });
    return { win, reload, location };
  }

  it("renews a window that already carries a runtime instead of installing again", () => {
    const renew = vi.fn(() => true);
    const { win, reload } = reusedWindow(renew);
    install(win, initial, "");
    expect(renew).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads a reused window whose runtime cannot renew it", () => {
    const refused = reusedWindow(() => false);
    install(refused.win, initial, "");
    expect(refused.reload).toHaveBeenCalledTimes(1);
    expect(refused.reload.mock.contexts[0]).toBe(refused.location);
    const older = reusedWindow(undefined);
    install(older.win, initial, "");
    expect(older.reload).toHaveBeenCalledTimes(1);
  });
});
