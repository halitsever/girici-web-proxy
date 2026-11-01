import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseSiteDomain, type SiteDomain } from "@girici/engine/shared";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { powRouter } from "../src/routes/pow.ts";
import { meetsDifficulty } from "../src/pow/tokens.ts";

let server: Server;
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function listen(siteDomain?: SiteDomain): Promise<string> {
  const store = new AuthStore(openDb(":memory:"));
  const app = express();
  app.use(powRouter({ store, difficulty: 4, siteDomain }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function solveForTest(challenge: string, difficulty: number): string {
  let nonce = 0;
  while (!meetsDifficulty(challenge, String(nonce), difficulty)) nonce++;
  return String(nonce);
}

function wrongNonce(challenge: string, difficulty: number): string {
  let nonce = 0;
  while (meetsDifficulty(challenge, String(nonce), difficulty)) nonce++;
  return String(nonce);
}

function answer(base: string, body: unknown, origin = base): Promise<Response> {
  return fetch(`${base}/_g/pow`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

async function challengeFrom(base: string): Promise<{ challenge: string; difficulty: number }> {
  return (await (await fetch(`${base}/_g/pow`)).json()) as { challenge: string; difficulty: number };
}

describe("powRouter", () => {
  it("hands out a challenge and sets the visitor cookie for a right answer, once", async () => {
    const base = await listen();
    const issued = await fetch(`${base}/_g/pow`);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const { challenge, difficulty } = (await issued.json()) as { challenge: string; difficulty: number };
    expect(difficulty).toBe(4);
    const nonce = solveForTest(challenge, difficulty);
    expect((await answer(base, { challenge, nonce: wrongNonce(challenge, difficulty) })).status).toBe(403);
    const ok = await answer(base, { challenge, nonce });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("set-cookie")).toMatch(
      /^girici-visitor=[^;]+; Max-Age=86400; Path=\/; .*HttpOnly; SameSite=Lax/,
    );
    expect(ok.headers.get("set-cookie")).not.toContain("Secure");
    expect((await answer(base, { challenge, nonce })).status).toBe(403);
  });

  it("gives a page served over https the __Host- Secure visitor cookie", async () => {
    const base = await listen();
    const { challenge, difficulty } = await challengeFrom(base);
    const ok = await answer(
      base,
      { challenge, nonce: solveForTest(challenge, difficulty) },
      base.replace("http:", "https:"),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("set-cookie")).toMatch(/^__Host-girici-visitor=[^;]+;.*; Secure/);
  });

  it("hands the visitor cookie to every site host in subdomain mode", async () => {
    const base = await listen(parseSiteDomain("proxy.test") ?? undefined);
    const plain = await challengeFrom(base);
    const http = await answer(base, { challenge: plain.challenge, nonce: solveForTest(plain.challenge, 4) });
    expect(http.headers.get("set-cookie")).toMatch(
      /^girici-visitor=[^;]+; Max-Age=86400; Domain=proxy\.test; Path=\/_g\/; .*HttpOnly; SameSite=Lax/,
    );
    const secure = await challengeFrom(base);
    const https = await answer(
      base,
      { challenge: secure.challenge, nonce: solveForTest(secure.challenge, 4) },
      base.replace("http:", "https:"),
    );
    expect(https.headers.get("set-cookie")).toMatch(/^__Secure-girici-visitor=[^;]+;.*Domain=proxy\.test;.*; Secure/);
  });

  it("refuses an answer from another site before reading it", async () => {
    const base = await listen();
    const { challenge, difficulty } = await challengeFrom(base);
    const res = await answer(base, { challenge, nonce: solveForTest(challenge, difficulty) }, "http://evil.test");
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects an answer with a missing or mistyped field", async () => {
    const base = await listen();
    const { challenge } = await challengeFrom(base);
    expect((await answer(base, { challenge })).status).toBe(400);
    expect((await answer(base, { challenge, nonce: 7 })).status).toBe(400);
    expect((await answer(base, { nonce: "7" })).status).toBe(400);
  });

  it("limits challenges per client", async () => {
    const base = await listen();
    for (let i = 0; i < 30; i++) expect((await fetch(`${base}/_g/pow`)).status).toBe(200);
    expect((await fetch(`${base}/_g/pow`)).status).toBe(429);
  });

  it("answers only the exact path", async () => {
    const base = await listen();
    expect((await fetch(`${base}/_g/POW`)).status).toBe(404);
    expect((await fetch(`${base}/_g/pow/`)).status).toBe(404);
  });
});
