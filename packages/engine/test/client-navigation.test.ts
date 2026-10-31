import { describe, expect, it } from "vitest";
import type { CookieBridge } from "../src/client/cookies.ts";
import { createHelpers } from "../src/client/helpers.ts";
import { createFakeLocation } from "../src/client/location.ts";
import { installNavigation } from "../src/client/navigation.ts";
import { createUrlContext, type Realm } from "../src/client/url-context.ts";
import type { WindowGuard } from "../src/client/windows.ts";
import { recordingCalls } from "./recording-calls.ts";
import { REPLACED_BUILTINS, withReplaced } from "./replaced-builtins.ts";

const ORIGIN = "http://proxy.test";
const PAGE = `${ORIGIN}/~/https/a.test/dir/page`;

class FakeNode {
  get baseURI(): string {
    return PAGE;
  }
}

const HTML = "http://www.w3.org/1999/xhtml";

class FakeElement extends FakeNode {
  readonly attributes = new Map<string, { value: string }>();
  // One getter on the base prototype reads a field the subclasses set, as the DOM's single accessor does.
  tag = "div";
  space = HTML;
  get localName(): string {
    return this.tag;
  }
  get namespaceURI(): string {
    return this.space;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name)?.value ?? null;
  }
  constructor(attributes: Record<string, string> = {}) {
    super();
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, { value });
  }
  getAttributeNode(name: string): { value: string } | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

/** A window whose natives log the URL they would load; each gets its own classes, since installing patches them. */
function fakeWindow() {
  const loads: string[] = [];
  const listeners: Array<[string, (event: unknown) => void]> = [];
  class History {
    pushState(_data: unknown, _unused: string, url?: string) {
      loads.push(`push ${url}`);
    }
    replaceState(_data: unknown, _unused: string, url?: string) {
      loads.push(`replace ${url}`);
    }
  }
  /** Event members are accessors on the prototype, as in the DOM. */
  class Event {
    readonly #type: string;
    readonly #path: unknown[];
    #prevented = false;
    constructor(type: string, path: unknown[]) {
      this.#type = type;
      this.#path = path;
    }
    get type(): string {
      return this.#type;
    }
    get target(): unknown {
      return this.#path[0];
    }
    get defaultPrevented(): boolean {
      return this.#prevented;
    }
    composedPath(): unknown[] {
      return this.#path;
    }
    preventDefault(): void {
      this.#prevented = true;
    }
  }
  class HTMLFormElement extends FakeElement {
    override tag = "form";
    submit(): void {
      loads.push(`submit ${this.getAttributeNode("action")?.value}`);
    }
    requestSubmit(): void {
      loads.push(`request ${this.getAttributeNode("action")?.value}`);
    }
  }
  const win = {
    location: { href: PAGE, origin: ORIGIN },
    document: new FakeNode(),
    Node: FakeNode,
    History,
    Element: FakeElement,
    Event,
    HTMLAnchorElement: class extends FakeElement {
      override tag = "a";
    },
    HTMLAreaElement: class extends FakeElement {
      override tag = "area";
    },
    SVGAElement: class extends FakeElement {
      override tag = "a";
      override space = "http://www.w3.org/2000/svg";
    },
    HTMLFormElement,
    DOMException: Error,
    open: (url: string) => {
      loads.push(`open ${url}`);
      return null;
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.push([type, listener]),
  };
  return { win, loads, listeners };
}

const asIs: WindowGuard = { wrap: (value) => value, isWrapper: () => false, reset: () => {} };
const noBlobs = {
  swap: (url: string) => url,
  swapLink: (() => {}) as (link: unknown, sticky?: boolean) => void,
  restoreLinks: () => {},
  swapForm: () => {},
};
const noCookies = { pendingWrites: () => null } as unknown as CookieBridge;

function installed(blobs: typeof noBlobs = noBlobs) {
  const fake = fakeWindow();
  const { win } = fake;
  const natives = [win.open, win.HTMLFormElement.prototype.submit, win.History.prototype.pushState];
  const ctx = createUrlContext(win as unknown as Realm);
  installNavigation(
    win as unknown as Realm,
    ctx,
    noCookies,
    (fn, self, args) => Reflect.apply(fn, self, args),
    asIs,
    blobs,
  );
  const location = createFakeLocation({
    real: ctx.realUrl,
    navigate: (url, mode) => fake.loads.push(`${mode} ${url}`),
    reload: () => {},
    setHash: () => {},
  });
  const nativeLocation = {};
  const helpers = createHelpers({
    nativeLocation,
    fakeLocation: location,
    isLocation: (value) => value === nativeLocation,
    fakeFor: () => null,
    isWindowOrDocument: () => false,
    navigationUrl: ctx.toProxy,
    rewrite: {} as never,
    indirectEval: (code) => code,
    messageTarget: (value) => value,
    wrapWindow: (value) => value,
    realOrigin: () => "https://a.test",
    site: () => undefined,
    renew: () => false,
  });
  const click = (link: FakeElement) => {
    for (const [type, listener] of fake.listeners) {
      if (type === "click") listener(new fake.win.Event(type, [link]));
    }
  };
  return { ...fake, natives, location, nativeLocation, helpers, click };
}

describe("installNavigation", () => {
  for (const [name, target, key, replacement] of REPLACED_BUILTINS) {
    it(`keeps every navigation in the proxy when ${name} is replaced`, () => {
      const { win, loads, location, nativeLocation, helpers, click } = installed();
      const link = new win.HTMLAnchorElement({ href: "https://b.test/link" });
      const form = new win.HTMLFormElement({ action: "/search" });
      const assigned = withReplaced(target, key, replacement, () => {
        win.open("https://b.test/open");
        click(link);
        form.submit();
        location.assign("/next");
        return helpers.N(nativeLocation, "https://b.test/set");
      });
      expect([...loads, link.getAttributeNode("href")?.value, assigned]).toEqual([
        "open /~/https/b.test/open",
        "submit /~/https/a.test/search",
        "assign /~/https/a.test/next",
        "/~/https/b.test/link",
        "/~/https/b.test/set",
      ]);
    });
  }

  it("never hands a native opener, submitter or history method to a replaced call", () => {
    const { win, natives } = installed();
    const form = new win.HTMLFormElement({ action: "/search" });
    const history = new win.History();
    const seen = recordingCalls(() => {
      win.open("https://b.test/");
      form.submit();
      form.requestSubmit();
      history.pushState({}, "", "/pushed");
    });
    expect(natives.filter((native) => seen.includes(native))).toEqual([]);
  });
});

describe("blob links", () => {
  it("restores a clicked link's blob swap at once when Array.prototype.includes is replaced", () => {
    const swaps: unknown[] = [];
    const { win, click } = installed({ ...noBlobs, swapLink: (_link, sticky) => swaps.push(sticky) });
    const link = new win.HTMLAnchorElement({ href: "blob:http://proxy.test/1" });
    withReplaced(Array.prototype, "includes", { value: () => true }, () => click(link));
    expect(swaps).toEqual([false]);
  });
});

describe("listening again", () => {
  it("adds every listener back when the page replaced the array iterator", () => {
    const fake = fakeWindow();
    const ctx = createUrlContext(fake.win as unknown as Realm);
    const nav = installNavigation(
      fake.win as unknown as Realm,
      ctx,
      noCookies,
      (fn, self, args) => Reflect.apply(fn, self, args),
      asIs,
      noBlobs,
    );
    const first = fake.listeners.length;
    fake.listeners.length = 0;
    withReplaced(Array.prototype, Symbol.iterator, { value: function* () {} }, () => nav.listen());
    expect(first).toBeGreaterThan(0);
    expect(fake.listeners.length).toBe(first);
  });
});

describe("Navigation API", () => {
  it("proxies and swaps a URL given to Navigation.prototype.navigate itself", () => {
    const fake = fakeWindow();
    const calls: unknown[] = [];
    class Navigation {
      navigate(url: string) {
        calls.push(url);
      }
    }
    const navigation = new Navigation();
    Object.assign(fake.win, { Navigation, navigation });
    const ctx = createUrlContext(fake.win as unknown as Realm);
    installNavigation(
      fake.win as unknown as Realm,
      ctx,
      noCookies,
      (fn, self, args) => Reflect.apply(fn, self, args),
      asIs,
      {
        ...noBlobs,
        swap: (url) => (url.includes("blob:") ? "blob:boot" : url),
      },
    );
    Reflect.apply(Navigation.prototype.navigate, navigation, ["blob:http://proxy.test/1"]);
    Reflect.apply(Object.getPrototypeOf(navigation).navigate, navigation, ["https://b.test/x"]);
    navigation.navigate("/y");
    expect(calls).toEqual(["blob:boot", "/~/https/b.test/x", "/~/https/a.test/y"]);
  });
});

describe("link fix-ups", () => {
  it("still fixes a clicked link after the page replaced the classes and event methods it would test", () => {
    const { win, click } = installed();
    const link = new win.HTMLAnchorElement({ href: "https://b.test/link" });
    const replaced = withReplaced(win, "HTMLAnchorElement", { value: class {} }, () =>
      withReplaced(win.Event.prototype, "composedPath", { value: () => [] }, () => {
        click(link);
        return link.getAttributeNode("href")?.value;
      }),
    );
    expect(replaced).toBe("/~/https/b.test/link");
  });
});
