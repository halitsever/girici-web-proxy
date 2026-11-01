import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_PREFS, MESSAGE_ENVELOPE, type SiteConfigAnswer } from "../src/shared/protocol.ts";
import { toBase64Url } from "../src/shared/seal-cipher.ts";
import { readMessageEnvelope, readSiteConfigAnswer, readSitePrefs } from "../src/shared/site-config.ts";
import { REPLACED_BUILTINS, withPrototypeAdditions, withReplaced } from "./replaced-builtins.ts";

const answer: SiteConfigAnswer = {
  v: 1,
  domain: "proxy.test",
  label: "k6wjalxihe6pja6woodbryo47k",
  key: toBase64Url(new Uint8Array(32).fill(7)),
  prefs: { blockThirdPartyCookies: false, sealAddresses: true, toolbar: false, engine: "Bing", seen: true },
  instanceSeal: true,
  deepLinkWarning: false,
};

const envelope = { [MESSAGE_ENVELOPE]: 1, o: "a", s: "b", t: "*", d: 1 };

describe("site config readers", () => {
  it("fills each bad prefs field with its default", () => {
    expect(readSitePrefs({ toolbar: false, engine: "Ask" })).toEqual({ ...DEFAULT_SITE_PREFS, toolbar: false });
    expect(readSitePrefs(null)).toEqual(DEFAULT_SITE_PREFS);
    expect(readSitePrefs("x")).toEqual(DEFAULT_SITE_PREFS);
    expect(readSitePrefs({ blockThirdPartyCookies: "no", sealAddresses: 1, engine: "toString", seen: "yes" })).toEqual(
      DEFAULT_SITE_PREFS,
    );
    expect(DEFAULT_SITE_PREFS).toEqual({
      blockThirdPartyCookies: true,
      sealAddresses: false,
      toolbar: true,
      engine: "DuckDuckGo",
      seen: false,
    });
  });

  it("reads whether this browser opened a site from Girici", () => {
    expect(readSitePrefs({ seen: true })).toEqual({ ...DEFAULT_SITE_PREFS, seen: true });
    expect(readSitePrefs({ seen: false })).toEqual(DEFAULT_SITE_PREFS);
    expect(readSitePrefs(Object.create({ seen: true }))).toEqual(DEFAULT_SITE_PREFS);
  });

  it("reads a site config answer and refuses a malformed one", () => {
    expect(readSiteConfigAnswer(JSON.parse(JSON.stringify(answer)))).toEqual(answer);
    expect(readSiteConfigAnswer({ ...answer, key: null })).toEqual({ ...answer, key: null });
    for (const bad of [
      { ...answer, v: 2 },
      { ...answer, label: 5 },
      { ...answer, key: 5 },
      { ...answer, key: "not base64url!" },
      { ...answer, key: toBase64Url(new Uint8Array(16)) },
      { ...answer, label: "k6wjalxihe6pja6woodbryo40k" },
      { ...answer, domain: "localhost" },
      { ...answer, domain: "Proxy.test" },
      { ...answer, instanceSeal: "yes" },
      { ...answer, deepLinkWarning: undefined },
      { ...answer, deepLinkWarning: 1 },
      null,
      "answer",
    ]) {
      expect(readSiteConfigAnswer(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readSiteConfigAnswer({ ...answer, prefs: { toolbar: false } })?.prefs).toEqual({
      ...DEFAULT_SITE_PREFS,
      toolbar: false,
    });
    expect(readSiteConfigAnswer(Object.create(answer))).toBeNull();
  });

  it("reads only an envelope's own fields", () => {
    expect(readMessageEnvelope({ "\u0000girici": 1, o: "a", s: "b", t: "*", d: 1 })).toEqual(envelope);
    expect(readMessageEnvelope(Object.create(envelope))).toBeNull();
    const missing: Record<string, unknown> = { ...envelope };
    delete missing.t;
    expect(readMessageEnvelope(missing)).toBeNull();
    expect(readMessageEnvelope({ ...envelope, [MESSAGE_ENVELOPE]: 2 })).toBeNull();
    expect(readMessageEnvelope({ ...envelope, o: 1 })).toBeNull();
    expect(readMessageEnvelope("\u0000girici")).toBeNull();
    expect(readMessageEnvelope(null)).toBeNull();
    const withoutData: Record<string, unknown> = { ...envelope };
    delete withoutData.d;
    expect(readMessageEnvelope(withoutData)).toEqual({ ...withoutData, d: undefined });
  });

  it("reads the same while a page has replaced built-ins or added fields to Object.prototype", () => {
    const additions = {
      [MESSAGE_ENVELOPE]: { value: 1, writable: true },
      o: { value: "https://evil.test", writable: true },
      s: { value: "https://evil.test", writable: true },
      t: { value: "*", writable: true },
      toolbar: { value: false, writable: true },
      engine: { value: "Bing", writable: true },
    };
    for (const [name, target, property, replacement] of REPLACED_BUILTINS) {
      withReplaced(target, property, replacement, () =>
        withPrototypeAdditions(additions, () => {
          expect(readMessageEnvelope({ d: 1 }), name).toBeNull();
          expect(readMessageEnvelope({ ...envelope }), name).toEqual(envelope);
          expect(readSitePrefs({}), name).toEqual(DEFAULT_SITE_PREFS);
          expect(readSiteConfigAnswer({ ...answer }), name).toEqual(answer);
        }),
      );
    }
  });
});
