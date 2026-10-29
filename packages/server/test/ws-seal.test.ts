import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WS_SEAL_PATH } from "@girici/engine/shared";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { wsSealRouter } from "../src/routes/ws-seal.ts";
import { openWsSeal, SEAL_TTL_MS, sealWsHandshake } from "../src/ws/seal.ts";

const secret = "a".repeat(64);
const target = new URL("wss://chat.test/socket");

describe("WebSocket seals", () => {
  it("opens a seal for the target origin it was made for", () => {
    const seal = sealWsHandshake(secret, { target, origin: "https://chat.test", cookie: "sid=1" });
    expect(openWsSeal(secret, seal, new URL("wss://chat.test/other?x=1"))).toEqual({
      origin: "https://chat.test",
      cookie: "sid=1",
    });
  });

  it("refuses another target, an expired, tampered or foreign seal, and junk", () => {
    const now = 1_000_000;
    const seal = sealWsHandshake(secret, { target, origin: "https://chat.test", cookie: "sid=1" }, now);
    const flipped = seal.slice(0, 20) + (seal[20] === "A" ? "B" : "A") + seal.slice(21);
    expect(openWsSeal(secret, seal, new URL("wss://evil.test/"), now)).toBeNull();
    expect(openWsSeal(secret, seal, target, now + SEAL_TTL_MS + 1)).toBeNull();
    expect(openWsSeal(secret, flipped, target, now)).toBeNull();
    expect(openWsSeal("b".repeat(64), seal, target, now)).toBeNull();
    expect(openWsSeal(secret, "junk", target, now)).toBeNull();
  });
});

describe("wsSealRouter", () => {
  let server: Server;
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function listen(): Promise<{ base: string; store: AuthStore }> {
    const store = new AuthStore(openDb(":memory:"));
    const app = express();
    app.use(wsSealRouter(store));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
  }

  const send = (base: string, body: unknown, origin = base) =>
    fetch(`${base}${WS_SEAL_PATH}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("seals for same-origin callers and refuses junk", async () => {
    const { base, store } = await listen();
    const ok = await send(base, { url: "wss://chat.test/socket", origin: "https://chat.test", cookie: "sid=1" });
    expect(ok.status).toBe(200);
    const { seal } = (await ok.json()) as { seal: string };
    expect(openWsSeal(store.sessionSecret(), seal, new URL("wss://chat.test/"))).toEqual({
      origin: "https://chat.test",
      cookie: "sid=1",
    });
    const fine = { url: "wss://chat.test/", origin: "https://chat.test", cookie: null };
    expect((await send(base, fine, "https://evil.test")).status).toBe(403);
    expect((await send(base, { ...fine, url: "https://chat.test/" })).status).toBe(400);
    expect((await send(base, { ...fine, origin: "https://chat.test/page" })).status).toBe(400);
    expect((await send(base, { ...fine, cookie: "a=1\r\nx: y" })).status).toBe(400);
  });

  it("answers only at its exact path", async () => {
    const { base } = await listen();
    const res = await fetch(`${base}${WS_SEAL_PATH}/`, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ url: "wss://chat.test/", origin: "https://chat.test", cookie: null }),
    });
    expect(res.status).toBe(404);
  });
});

describe("WebSocket seal input", () => {
  it("treats a seal that is not a string as junk instead of throwing", () => {
    for (const sealed of [1, {}, true, null, undefined]) expect(openWsSeal(secret, sealed, target)).toBeNull();
  });
});
