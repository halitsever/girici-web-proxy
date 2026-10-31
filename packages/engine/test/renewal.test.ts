import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSteps, engineScriptConfig } from "../src/client/renewal.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";

const origin = "http://p.test";
const config = JSON.stringify({ v: PROTOCOL_VERSION, cookies: [] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engineScriptConfig", () => {
  it("reads a config only from the engine's own script", () => {
    expect(engineScriptConfig({ src: `${origin}/_g/client.AB12CD34.js`, config }, origin)).toEqual({
      v: PROTOCOL_VERSION,
      cookies: [],
    });
    for (const src of [
      `${origin}/~/https/a.test/_g/client.AB12CD34.js`,
      "http://evil.test/_g/client.AB12CD34.js",
      `${origin}/_g/worker.AB12CD34.js`,
    ])
      expect(engineScriptConfig({ src, config }, origin), src).toBeNull();
    expect(
      engineScriptConfig({ src: `${origin}/_g/client.AB12CD34.js`, config: '{"v":1,"cookies":[]}' }, origin),
    ).toBeNull();
    expect(engineScriptConfig(null, origin)).toBeNull();
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
});
