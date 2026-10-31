import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { createLogger } from "../src/log.ts";
import { healthRouter } from "../src/routes/health.ts";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(store: AuthStore, lines: string[]): Promise<string> {
  const app = express();
  app.use(
    healthRouter(
      store,
      createLogger("debug", (line) => lines.push(line)),
    ),
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`;
}

describe("/healthz", () => {
  it("answers ok while the database answers", async () => {
    const url = await start(new AuthStore(openDb(":memory:")), []);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers 503 when the database fails and logs it once, without the cause in the body", async () => {
    const store = new AuthStore(openDb(":memory:"));
    const lines: string[] = [];
    const url = await start(store, lines);
    store.close();
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("database unavailable");
    }
    expect(lines.filter((line) => line.includes("Health check failed"))).toHaveLength(1);
  });
});
