import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { poRouter, type PoTokenSource } from "../src/routes/pot.ts";

let server: Server;

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function listen(minter: PoTokenSource, rateLimit?: { windowMs: number; max: number }): Promise<string> {
  const app = express();
  app.use(poRouter({ minter, rateLimit }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function post(base: string, origin: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return fetch(`${base}/_g/pot`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("poRouter", () => {
  it("rejects a cross-origin POST", async () => {
    const base = await listen({ mint: async () => "pot:x" });
    const res = await post(base, "https://evil.test", { contentBinding: "v" });
    expect(res.status).toBe(403);
  });

  it("returns the minted token for a same-origin POST", async () => {
    const base = await listen({ mint: async (b) => `pot:${b}` });
    const res = await post(base, base, { contentBinding: "visitor-123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ poToken: "pot:visitor-123" });
  });

  it("passes through a null token when minting fails", async () => {
    const base = await listen({ mint: async () => null });
    const res = await post(base, base, { contentBinding: "v" });
    expect(await res.json()).toEqual({ poToken: null });
  });

  it("rejects a request without a content binding", async () => {
    const base = await listen({ mint: async () => "pot:x" });
    const res = await post(base, base, {});
    expect(res.status).toBe(400);
  });

  it("rate-limits after the configured max per window", async () => {
    const base = await listen({ mint: async () => "pot:x" }, { windowMs: 60_000, max: 2 });
    expect((await post(base, base, { contentBinding: "v" })).status).toBe(200);
    expect((await post(base, base, { contentBinding: "v" })).status).toBe(200);
    expect((await post(base, base, { contentBinding: "v" })).status).toBe(429);
  });
});

describe("poRouter exact path", () => {
  it("mints only at its exact, case-sensitive path", async () => {
    const base = await listen({ mint: async () => "pot:x" });
    const res = await fetch(`${base}/_g/POT`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ contentBinding: "v" }),
    });
    expect(res.status).toBe(404);
  });
});
