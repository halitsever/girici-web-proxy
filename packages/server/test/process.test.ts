import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "girici-data-"));
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function start(env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: { GIRICI_DATA_DIR: dataDir, ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  return child;
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

function waitForOutput(child: ChildProcess, pattern: RegExp): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (pattern.test(output)) resolve();
    });
    child.once("exit", (code) => reject(new Error(`exited with ${code} before printing ${pattern}: ${output}`)));
  });
}

describe("server process", () => {
  it("exits with code 0 shortly after SIGTERM", async () => {
    const port = await freePort();
    const child = start({ PORT: String(port), HOST: "127.0.0.1", LOG_LEVEL: "info" });
    const exited = exitCode(child);
    await waitForOutput(child, /listening/);
    const started = Date.now();
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 15_000);

  it("closes open WebSockets with 1001 on SIGTERM and still exits with code 0", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "girici-data-"));
    const store = new AuthStore(openDb(join(publicDir, "girici.db")));
    store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
    store.setPublicAccess(true);
    store.close();
    const port = await freePort();
    const child = start({ PORT: String(port), HOST: "127.0.0.1", LOG_LEVEL: "info", GIRICI_DATA_DIR: publicDir });
    const exited = exitCode(child);
    await waitForOutput(child, /listening/);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/_g/ws`, ["girici.v1"], {
      headers: { origin: `http://127.0.0.1:${port}` },
    });
    await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    const started = Date.now();
    child.kill("SIGTERM");
    expect(await closed).toBe(1001);
    expect(await exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 15_000);

  it("prints the trust-everything warning even at LOG_LEVEL=error", async () => {
    const port = await freePort();
    const child = start({ PORT: String(port), HOST: "127.0.0.1", LOG_LEVEL: "error", GIRICI_TRUST_PROXY: "true" });
    const exited = exitCode(child);
    // The setup banner comes after listen, once the signal handlers are in place.
    await waitForOutput(child, /GIRICI_TRUST_PROXY=true trusts every X-Forwarded-For entry[\s\S]*setup code/);
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
  }, 15_000);

  it("starts in subdomain mode and keeps a site secret in the database", async () => {
    const siteDir = mkdtempSync(join(tmpdir(), "girici-data-"));
    const port = await freePort();
    const child = start({
      PORT: String(port),
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      GIRICI_DATA_DIR: siteDir,
      GIRICI_SITE_DOMAIN: "proxy.test",
    });
    const exited = exitCode(child);
    await waitForOutput(child, /Subdomain mode: sites open on \*\.proxy\.test[\s\S]*listening/);
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    const db = openDb(join(siteDir, "girici.db"));
    expect(db.prepare("SELECT value FROM settings WHERE key = 'site_secret'").get()).toEqual({
      value: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    db.close();
  }, 15_000);

  it("exits with code 1 and names the variable when PORT is invalid", async () => {
    const child = start({ PORT: "abc" });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    expect(await exitCode(child)).toBe(1);
    expect(stderr).toMatch(/PORT/);
  }, 15_000);
});
