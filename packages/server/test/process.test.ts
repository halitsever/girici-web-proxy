import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "girici-data-"));

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
  return spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: { GIRICI_DATA_DIR: dataDir, ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
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

  it("exits with code 1 and names the variable when PORT is invalid", async () => {
    const child = start({ PORT: "abc" });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    expect(await exitCode(child)).toBe(1);
    expect(stderr).toMatch(/PORT/);
  }, 15_000);
});
