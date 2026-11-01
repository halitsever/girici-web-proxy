import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_PREFS, type EnginePrefs } from "../src/shared/protocol.ts";
import { decodeUrl } from "../src/shared/codec.ts";
import { MasterSealer, type OpenSealed } from "../src/shared/sealed-address.ts";
import { DeepLinkWarning, WARNING_CSP, type ContinueRequest } from "../src/sw/deep-link-warning.ts";
import type { KeyStore } from "../src/sw/sealing.ts";

const origin = "https://girici.test";
const target = new URL("https://site-a.test/a?b=1");
const open: OpenSealed = () => null;

function fakePrefs(initial: Partial<EnginePrefs> = {}) {
  let current: EnginePrefs = { ...DEFAULT_ENGINE_PREFS, ...initial };
  return {
    ready: async () => {},
    current: () => ({ ...current }),
    async set(update: Partial<EnginePrefs>) {
      current = { ...current, ...update };
    },
  };
}

function memoryKeys(): KeyStore {
  const stored = new Map<string, Uint8Array>();
  return {
    load: async () => stored.get("warning") ?? null,
    loadOrCreate: async (fresh) => {
      const key = stored.get("warning") ?? fresh();
      stored.set("warning", key);
      return key;
    },
  };
}

const brokenKeys: KeyStore = {
  load: async () => {
    throw new Error("no idb");
  },
  loadOrCreate: async () => {
    throw new Error("no idb");
  },
};

function warning(options: { seen?: boolean; instance?: boolean; keys?: KeyStore } = {}) {
  const prefs = fakePrefs({ seen: options.seen ?? false });
  const w = new DeepLinkWarning({
    prefs,
    instance: { deepLinkWarning: async () => options.instance ?? true },
    keys: options.keys ?? memoryKeys(),
  });
  return { w, prefs };
}

function continueRequest(fields: Record<string, string>): ContinueRequest {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return { method: "POST", mode: "navigate", formData: async () => form };
}

/** The hidden form fields, read back the way a browser would submit them. */
function fields(html: string): { to: string; t: string } {
  const value = (name: string) => {
    const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
    if (!match) throw new Error(`no ${name} field`);
    return (match[1] as string).replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  };
  return { to: value("to"), t: value("t") };
}

describe("DeepLinkWarning", () => {
  it("asks for the warning until this browser has seen Girici, and only while the instance wants it", async () => {
    expect(await warning({ seen: false, instance: true }).w.needed()).toBe(true);
    expect(await warning({ seen: true, instance: true }).w.needed()).toBe(false);
    expect(await warning({ seen: false, instance: false }).w.needed()).toBe(false);
  });

  it("serves a page without script that cannot be framed", async () => {
    const res = await warning().w.page("/~/https/site-a.test/a?b=1", target);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(WARNING_CSP);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("This page opens through Girici");
    expect(html).toContain("The next page comes from site-a.test, not from the people who run this server.");
    expect(html).toContain("<code>https://site-a.test/a?b=1</code>");
    expect(html).toContain('action="/_g/rpc/continue"');
    expect(html).toContain("Continue to site-a.test");
    expect(html).toContain('<a href="/">Go to Girici&#39;s home page</a>');
  });

  it("escapes every value it writes into the page", async () => {
    const to = "/~/https/site-a.test/it's?a=1&b=<x>";
    const res = await warning().w.page(to, new URL("https://site-a.test/it's?a=1&b=<x>"));
    const html = await res.text();
    expect(html).not.toContain("it's");
    expect(html).not.toContain("<x>");
    expect(fields(html).to).toBe(to);
  });

  it("continues to the verified address and remembers that this browser has seen it", async () => {
    const { w, prefs } = warning();
    const { to, t } = fields(await (await w.page("/~/https/site-a.test/a?b=1", target)).text());
    const res = await w.accept(continueRequest({ to, t }), open, origin);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${origin}/~/https/site-a.test/a?b=1`);
    expect(prefs.current().seen).toBe(true);
  });

  it("sends a forged or altered Continue back to the warning without remembering it", async () => {
    const { w, prefs } = warning();
    const { t } = fields(await (await w.page("/~/https/site-a.test/", target)).text());
    const res = await w.accept(continueRequest({ to: "/~/https/phish.test/", t }), open, origin);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${origin}/~/https/phish.test/`);
    expect(prefs.current().seen).toBe(false);
    for (const forged of ["", "x", "!!", t.slice(1)]) {
      await w.accept(continueRequest({ to: "/~/https/site-a.test/", t: forged }), open, origin);
      expect(prefs.current().seen, forged).toBe(false);
    }
    await w.accept(continueRequest({ to: "/~/https/site-a.test/" }), open, origin);
    expect(prefs.current().seen).toBe(false);
    expect((await w.accept(continueRequest({ to: "/_g/admin/settings", t }), open, origin)).status).toBe(400);
    expect(
      (await w.accept({ ...continueRequest({ to: "/~/https/site-a.test/", t }), mode: "cors" }, open, origin)).status,
    ).toBe(403);
    expect(
      (await w.accept({ ...continueRequest({ to: "/~/https/site-a.test/", t }), method: "GET" }, open, origin)).status,
    ).toBe(403);
  });

  it("never redirects off this origin or to anything but a proxy address", async () => {
    const { w } = warning();
    for (const to of [
      "https://evil.test/~/https/site-a.test/",
      "//evil.test/~/https/site-a.test/",
      "/settings",
      "/~/javascript:alert(1)",
    ]) {
      const { t } = fields(await (await w.page(to, target)).text());
      const res = await w.accept(continueRequest({ to, t }), open, origin);
      expect(res.status, to).toBe(400);
      expect(res.headers.get("location"), to).toBeNull();
    }
    expect((await w.accept(continueRequest({ t: "x" }), open, origin)).status).toBe(400);
    const unreadable: ContinueRequest = {
      method: "POST",
      mode: "navigate",
      formData: async () => {
        throw new TypeError("not a form");
      },
    };
    expect((await w.accept(unreadable, open, origin)).status).toBe(400);
  });

  it("accepts a Continue after the worker restarted", async () => {
    const keys = memoryKeys();
    const { t } = fields(await (await warning({ keys }).w.page("/~/https/site-a.test/", target)).text());
    const { w, prefs } = warning({ keys });
    const res = await w.accept(continueRequest({ to: "/~/https/site-a.test/", t }), open, origin);
    expect(res.status).toBe(303);
    expect(prefs.current().seen).toBe(true);
  });

  it("keeps working on a key held in memory when the key store fails", async () => {
    const { w, prefs } = warning({ keys: brokenKeys });
    const { to, t } = fields(await (await w.page("/~/https/site-a.test/", target)).text());
    const res = await w.accept(continueRequest({ to, t }), open, origin);
    expect(res.status).toBe(303);
    expect(prefs.current().seen).toBe(true);
  });

  it("continues to a sealed address it can open", async () => {
    const master = new MasterSealer(new Uint8Array(32).fill(7));
    const sealedOpen: OpenSealed = (path) => master.open(path);
    const real = new URL("https://site-a.test/sealed?q=1");
    const to = master.seal(real);
    expect(decodeUrl(to)).toBeNull();
    const { w, prefs } = warning();
    const { t } = fields(await (await w.page(to, real)).text());
    const res = await w.accept(continueRequest({ to, t }), sealedOpen, origin);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${origin}${to}`);
    expect(prefs.current().seen).toBe(true);
  });
});
