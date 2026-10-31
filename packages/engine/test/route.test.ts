import { describe, expect, it } from "vitest";
import { MasterSealer } from "../src/shared/sealed-address.ts";
import {
  classifyRequest,
  isGuardedPath,
  isUiWindow,
  realUrlOf,
  requestClientUrl,
  reservedAccess,
  type Route,
  type RouteInput,
} from "../src/sw/route.ts";

const origin = "http://127.0.0.1:41000";
const page = `${origin}/~/https/site-a.test/dir/page`;

function input(url: string, extra: Partial<RouteInput> = {}): RouteInput {
  return { url, origin, navigation: false, clientUrl: page, referrer: null, ...extra };
}

// URL objects carry no own enumerable properties, so toEqual would call any two of them equal.
function summary(route: Route) {
  return route.kind === "proxy" ? { kind: route.kind, target: route.target.href, navigation: route.navigation } : route;
}

describe("classifyRequest", () => {
  it("passes reserved paths through", () => {
    for (const path of ["/", "/robots.txt", "/_g/sw.js", "/_g/r/https/x/"]) {
      expect(summary(classifyRequest(input(origin + path)))).toEqual({ kind: "passthrough" });
    }
  });

  it("proxies proxy paths and canonicalises them", () => {
    expect(
      summary(classifyRequest(input(`${origin}/~/https/site-a.test/x?y=1`, { navigation: true, clientUrl: null }))),
    ).toEqual({ kind: "proxy", target: "https://site-a.test/x?y=1", navigation: true });
    expect(
      summary(classifyRequest(input(`${origin}/~/https/site-a.test`, { navigation: true, clientUrl: null }))),
    ).toEqual({ kind: "redirect", location: "/~/https/site-a.test/" });
    expect(summary(classifyRequest(input(`${origin}/~/ftp/x/`)))).toEqual({ kind: "invalid" });
  });

  it("maps root-relative requests onto the page's real origin", () => {
    expect(summary(classifyRequest(input(`${origin}/style.css?v=2`)))).toEqual({
      kind: "redirect",
      location: "/~/https/site-a.test/style.css?v=2",
    });
    expect(
      summary(classifyRequest(input(`${origin}/page2`, { navigation: true, clientUrl: null, referrer: page }))),
    ).toEqual({ kind: "redirect", location: "/~/https/site-a.test/page2" });
  });

  it("proxies cross-origin subresources of proxied pages", () => {
    expect(summary(classifyRequest(input("https://cdn.site-a.test/b.png")))).toEqual({
      kind: "proxy",
      target: "https://cdn.site-a.test/b.png",
      navigation: false,
    });
  });

  it("proxies cross-origin requests from an unresolved blank or srcdoc client", () => {
    expect(summary(classifyRequest(input("https://evil.test/x", { clientUrl: "about:srcdoc" })))).toEqual({
      kind: "proxy",
      target: "https://evil.test/x",
      navigation: false,
    });
    expect(summary(classifyRequest(input("https://evil.test/x", { clientUrl: null })))).toEqual({
      kind: "proxy",
      target: "https://evil.test/x",
      navigation: false,
    });
  });

  it("leaves requests from the Girici UI alone", () => {
    expect(summary(classifyRequest(input("https://cdn.example.com/x.png", { clientUrl: `${origin}/` })))).toEqual({
      kind: "passthrough",
    });
    expect(summary(classifyRequest(input(`${origin}/unknown`, { clientUrl: `${origin}/` })))).toEqual({
      kind: "passthrough",
    });
  });
});

describe("reservedAccess", () => {
  const origin = "https://girici.test";
  const ui = { id: "ui-1", type: "window", frameType: "top-level", url: `${origin}/settings` };
  const known = new Set(["ui-1"]);
  const call = { mode: "cors" as RequestMode, destination: "" as RequestDestination, method: "POST" };

  it("lets the Girici UI call the admin API", () => {
    expect(reservedAccess("/_g/admin/settings", call, ui, origin, known)).toBe("allow");
    expect(reservedAccess("/_g/account", call, ui, origin, known)).toBe("allow");
  });

  it("refuses proxied pages, blank frames, blob windows, workers and unknown clients", () => {
    const clients = [
      { id: "ui-1", type: "window", frameType: "top-level", url: `${origin}/~/https/evil.test/` },
      { id: "ui-1", type: "window", frameType: "nested", url: "about:blank" },
      { id: "ui-1", type: "window", frameType: "top-level", url: `blob:${origin}/1` },
      { id: "ui-1", type: "worker", frameType: "none", url: `blob:${origin}/2` },
      undefined,
    ];
    for (const client of clients) {
      expect(reservedAccess("/_g/admin/settings", call, client, origin, known)).toBe("deny");
    }
  });

  it("refuses a window on a UI address that no UI navigation produced", () => {
    const ui = new Set(["ui-1"]);
    const at = (id: string) => ({ id, type: "window", frameType: "top-level", url: `${origin}/settings` });
    expect(isUiWindow(at("ui-1"), origin, ui)).toBe(true);
    expect(isUiWindow(at("page-7"), origin, ui)).toBe(false);
    expect(reservedAccess("/_g/admin/settings", call, at("page-7"), origin, ui)).toBe("deny");
  });

  it("allows top-level loads of the login screen but not framed ones", () => {
    const nav = (destination: RequestDestination) => ({ mode: "navigate" as RequestMode, destination, method: "GET" });
    expect(reservedAccess("/_g/login", nav("document"), undefined, origin, known)).toBe("allow");
    expect(reservedAccess("/_g/login", nav("iframe"), undefined, origin, known)).toBe("deny");
  });

  it("keeps the service worker's own endpoints away from every page", () => {
    expect(reservedAccess("/_g/pot", call, ui, origin, known)).toBe("deny");
    expect(reservedAccess("/_g/ws-seal", call, ui, origin, known)).toBe("deny");
  });
});

describe("isGuardedPath", () => {
  it("covers the admin API and leaves engine files and RPCs alone", () => {
    const guarded = [
      "/_g/account",
      "/_g/admin/settings",
      "/_g/logout",
      "/_g/login",
      "/_g/setup",
      "/_g/auth/state",
      "/_g/pot",
      "/_g/ws-seal",
    ];
    for (const path of guarded) expect(isGuardedPath(path)).toBe(true);
    const open = [
      "/_g/sw.js",
      "/_g/client.abc.js",
      "/_g/ui/app.js",
      "/_g/r/https/x.test/",
      "/_g/rpc/cookie",
      "/",
      "/robots.txt",
    ];
    for (const path of open) expect(isGuardedPath(path)).toBe(false);
  });
});

describe("isUiWindow", () => {
  const origin = "https://girici.test";
  const ui = new Set(["ui-1"]);
  const top = (path: string) => ({ id: "ui-1", type: "window", frameType: "top-level", url: `${origin}${path}` });

  it("knows the Girici UI by its routes", () => {
    for (const path of ["/", "/settings", "/account?tab=1", "/_g/login?next=%2F", "/_g/setup", "/Settings/"])
      expect(isUiWindow(top(path), origin, ui), path).toBe(true);
  });

  it("refuses documents the service worker made, such as its error pages", () => {
    for (const path of ["/~", "/~/ftp/x", "/~/https/", "/robots.txt", "/_g/sw.js", "/elsewhere"])
      expect(isUiWindow(top(path), origin, ui), path).toBe(false);
  });
});

describe("guarded path variants", () => {
  const origin = "https://girici.test";
  const ui = { id: "ui-1", type: "window", frameType: "top-level", url: `${origin}/settings` };
  const known = new Set(["ui-1"]);
  const call = { mode: "cors" as RequestMode, destination: "" as RequestDestination, method: "POST" };

  it("guards the spellings Express would also route", () => {
    for (const path of [
      "/_g/Admin/settings",
      "/_g/logout/",
      "/_g/AUTH/state",
      "/_g/pot/",
      "/_g/WS-SEAL",
      "/_g/account//",
    ])
      expect(isGuardedPath(path), path).toBe(true);
    expect(reservedAccess("/_g/POT", call, ui, origin, known)).toBe("deny");
    expect(reservedAccess("/_g/Admin/settings", call, undefined, origin, known)).toBe("deny");
  });
});

describe("requestClientUrl", () => {
  const identity = { page: "https://site-a.test/app?x=1", top: "https://site-a.test" };
  const window = { id: "t", type: "window", frameType: "top-level", url: page };
  const worker = { id: "w", type: "worker", frameType: "none", url: `blob:${origin}/0a1b` };
  const base = { client: undefined, identity: null };

  it("takes a window's own address", () => {
    expect(requestClientUrl({ ...base, client: window, identity }, origin)).toBe(page);
  });

  it("takes the proxy address of the page that started a worker", () => {
    expect(requestClientUrl({ ...base, client: worker, identity }, origin)).toBe(
      `${origin}/~/https/site-a.test/app?x=1`,
    );
    expect(requestClientUrl({ ...base, identity }, origin)).toBe(`${origin}/~/https/site-a.test/app?x=1`);
  });

  it("places no worker or clientless request that no page announced", () => {
    expect(requestClientUrl({ ...base, client: worker }, origin)).toBeNull();
    expect(requestClientUrl(base, origin)).toBeNull();
  });
});

describe("sealed addresses", () => {
  const master = new MasterSealer(new Uint8Array(32).fill(3));
  const origin = "https://proxy.test";
  const page = new URL("https://a.test/dir/page?x=1");
  const sealed = master.seal(page);
  const on = { origin, open: master.open, seal: (url: URL) => master.seal(url) };
  const load = { navigation: true, topLevelGet: true, clientUrl: null, referrer: null };
  const sealedSummary = (route: Route) => (route.kind === "proxy" ? { ...route, target: route.target.href } : route);

  it("opens a sealed page load", () => {
    expect(sealedSummary(classifyRequest({ ...on, ...load, url: origin + sealed }))).toEqual({
      kind: "proxy",
      target: page.href,
      navigation: true,
      sealed: true,
    });
  });

  it("moves a top-level page load of a plain address to its sealed address", () => {
    expect(classifyRequest({ ...on, ...load, url: `${origin}/~/https/a.test/dir/page?x=1` })).toEqual({
      kind: "redirect",
      location: sealed,
    });
  });

  it("leaves plain page loads alone while sealing is off", () => {
    expect(
      sealedSummary(
        classifyRequest({ ...load, origin, open: master.open, url: `${origin}/~/https/a.test/dir/page?x=1` }),
      ),
    ).toEqual({ kind: "proxy", target: page.href, navigation: true, sealed: false });
  });

  it("keeps frames and requests on plain addresses", () => {
    const plain = `${origin}/~/https/a.test/dir/page?x=1`;
    expect(classifyRequest({ ...on, ...load, topLevelGet: false, url: plain })).toMatchObject({
      kind: "proxy",
      sealed: false,
    });
    expect(classifyRequest({ ...on, ...load, navigation: false, topLevelGet: false, url: plain })).toMatchObject({
      kind: "proxy",
      sealed: false,
    });
  });

  it("seals a query a form or link put after the token", () => {
    expect(classifyRequest({ ...on, ...load, url: `${origin}${sealed}?q=find` })).toEqual({
      kind: "redirect",
      location: master.seal(new URL("https://a.test/dir/page?q=find")),
    });
    const fetched = classifyRequest({
      ...on,
      navigation: false,
      clientUrl: origin + sealed,
      referrer: null,
      url: `${origin}${sealed}?q=find`,
    });
    expect(sealedSummary(fetched)).toMatchObject({
      kind: "proxy",
      target: "https://a.test/dir/page?q=find",
      sealed: true,
    });
  });

  it("resolves relative requests of a sealed page against its real address", () => {
    const from = { ...on, navigation: false, clientUrl: origin + sealed, referrer: null };
    expect(sealedSummary(classifyRequest({ ...from, url: `${origin}/~/x/img/a.png` }))).toEqual({
      kind: "proxy",
      target: "https://a.test/dir/img/a.png",
      navigation: false,
      sealed: false,
    });
    expect(sealedSummary(classifyRequest({ ...from, url: `${origin}/~/up.css` }))).toMatchObject({
      target: "https://a.test/up.css",
    });
    expect(classifyRequest({ ...from, url: `${origin}/root.js` })).toEqual({
      kind: "redirect",
      location: "/~/https/a.test/root.js",
    });
  });

  it("sends a relative page load of a sealed page to its sealed or plain address", () => {
    const from = { ...on, ...load, referrer: origin + sealed };
    expect(classifyRequest({ ...from, url: `${origin}/~/x/next?a=1` })).toEqual({
      kind: "redirect",
      location: master.seal(new URL("https://a.test/dir/next?a=1")),
    });
    expect(classifyRequest({ ...from, url: `${origin}/other` })).toEqual({
      kind: "redirect",
      location: master.seal(new URL("https://a.test/other")),
    });
    expect(classifyRequest({ ...from, topLevelGet: false, url: `${origin}/~/x/frame` })).toEqual({
      kind: "redirect",
      location: "/~/https/a.test/dir/frame",
    });
  });

  it("does not let a relative path that looks like another site's token leave the page's site", () => {
    const b = master.seal(new URL("https://b.test/"));
    const fakeBody = `${b.slice(0, b.indexOf(".") + 1)}AAAA`;
    const route = classifyRequest({
      ...on,
      navigation: false,
      clientUrl: origin + sealed,
      referrer: null,
      url: origin + fakeBody,
    });
    expect(route.kind === "proxy" && route.target.hostname).toBe("a.test");
  });

  it("refuses a sealed address this browser cannot open", () => {
    const other = new MasterSealer(new Uint8Array(32).fill(4)).seal(page);
    expect(classifyRequest({ ...on, ...load, url: origin + other })).toEqual({ kind: "unsealable" });
    expect(classifyRequest({ origin, ...load, url: origin + sealed })).toEqual({ kind: "unsealable" });
  });

  it("seals a non-canonical plain address in one redirect", () => {
    expect(classifyRequest({ ...on, ...load, url: `${origin}/~/https/A.TEST/dir/page?x=1` })).toEqual({
      kind: "redirect",
      location: sealed,
    });
  });

  it("clears the sealed query for a bare question mark, as a form with no fields does", () => {
    expect(classifyRequest({ ...on, ...load, url: `${origin}${sealed}?` })).toEqual({
      kind: "redirect",
      location: master.seal(new URL("https://a.test/dir/page")),
    });
  });

  it("keeps a sealed page whose address does not open away from the Girici server", () => {
    const keyless = { origin, navigation: false, clientUrl: origin + sealed, referrer: null };
    expect(classifyRequest({ ...keyless, url: `${origin}/root.js` })).toEqual({ kind: "unsealable" });
    expect(classifyRequest({ origin, ...load, referrer: origin + sealed, url: `${origin}/next` })).toEqual({
      kind: "unsealable",
    });
  });

  it("refuses a path under a sealed page that resolves to no web URL instead of throwing", () => {
    const from = { ...on, ...load, referrer: origin + sealed };
    expect(classifyRequest({ ...from, url: `${origin}/~/x/javascript:alert(1)` })).toEqual({ kind: "invalid" });
    const fetched = { ...on, navigation: false, clientUrl: origin + sealed, referrer: null };
    expect(classifyRequest({ ...fetched, url: `${origin}/~/x/data:text/html,x` })).toEqual({ kind: "invalid" });
  });

  it("proxies what a sealed page sends to another origin", () => {
    const route = classifyRequest({
      ...on,
      navigation: false,
      clientUrl: origin + sealed,
      referrer: null,
      url: "https://b.test/x",
    });
    expect(sealedSummary(route)).toMatchObject({ kind: "proxy", target: "https://b.test/x" });
    const keyless = classifyRequest({
      origin,
      navigation: false,
      clientUrl: origin + sealed,
      referrer: null,
      url: "https://b.test/x",
    });
    expect(keyless.kind).toBe("proxy");
  });

  it("reads a sealed window's real address", () => {
    expect(realUrlOf(origin + sealed, origin, master.open)?.href).toBe(page.href);
    expect(realUrlOf(`${origin + sealed}#h`, origin, master.open)?.href).toBe(page.href);
    expect(realUrlOf(origin + sealed, origin)).toBeNull();
  });
});
