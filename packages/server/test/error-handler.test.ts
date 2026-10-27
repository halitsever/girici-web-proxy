import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../src/http/error-handler.ts";
import { createLogger } from "../src/log.ts";

const servers: Server[] = [];

async function serve(route: RequestHandler, lines: string[]): Promise<string> {
  const app = express();
  app.get("/test", route);
  app.use(errorHandler(createLogger("debug", (line) => lines.push(line))));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("errorHandler", () => {
  it("keeps the status of client errors and logs them only at debug level", async () => {
    const lines: string[] = [];
    const base = await serve(
      (_req, _res, next) => next(Object.assign(new Error("Failed to decode param"), { status: 400 })),
      lines,
    );
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Bad Request");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(lines.filter((line) => line.includes("ERROR"))).toEqual([]);
    expect(lines.filter((line) => line.includes("DEBUG") && line.includes("400"))).toHaveLength(1);
  });

  it("answers other errors with 500 and logs the stack at error level", async () => {
    const lines: string[] = [];
    const base = await serve(() => {
      throw new Error("boom");
    }, lines);
    const res = await fetch(`${base}/test`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Internal Server Error");
    expect(
      lines.filter((line) => line.includes("ERROR") && line.includes("boom") && line.includes(" at ")),
    ).toHaveLength(1);
  });
});
