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

class FakeElement extends FakeNode {
  readonly attributes = new Map<string, { value: string }>();
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
  class HTMLFormElement extends FakeElement {
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
    HTMLAnchorElement: class extends FakeElement {},
    HTMLAreaElement: class extends FakeElement {},
    SVGAElement: class extends FakeElement {},
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
const noCookies = { pendingWrites: () => null } as unknown as CookieBridge;

function installed() {
  const fake = fakeWindow();
  const { win } = fake;
  const natives = [win.open, win.HTMLFormElement.prototype.submit, win.History.prototype.pushState];
  const ctx = createUrlContext(win as unknown as Realm);
  installNavigation(win as unknown as Realm, ctx, noCookies, (fn, self, args) => Reflect.apply(fn, self, args), asIs);
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
    toProxy: ctx.toProxy,
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
      if (type === "click") listener({ composedPath: () => [link], defaultPrevented: false });
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
