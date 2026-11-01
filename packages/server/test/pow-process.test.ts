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

async function startChecked(): Promise<string> {
  const dataDir = mkdtempSync(join(tmpdir(), "girici-data-"));
  const store = new AuthStore(openDb(join(dataDir, "girici.db")));
  store.createAdmin({ username: "a", name: "A", email: "a@a.a", password: "pw-123456" });
  store.setPublicAccess(true);
  store.setProofOfWork(true);
  store.close();
  const port = await freePort();
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      GIRICI_DATA_DIR: dataDir,
      PORT: String(port),
      HOST: "127.0.0.1",
      GIRICI_POW_DIFFICULTY: "5",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (/listening/.test(output)) resolve();
    });
    child.once("exit", (code) => reject(new Error(`exited with ${code}: ${output}`)));
  });
  return `127.0.0.1:${port}`;
}

describe("browser check in the server process", () => {
  it("refuses unchecked visitors at both relays and hands out challenges at the configured difficulty", async () => {
    const host = await startChecked();
    const relay = await fetch(`http://${host}/_g/r/https/site-a.test/`, { headers: { "x-girici-relay": "1" } });
    expect(relay.status).toBe(403);
    expect(relay.headers.get("x-girici-error")).toBe("challenge");

    const issued = await fetch(`http://${host}/_g/pow`);
    expect(issued.status).toBe(200);
    expect(((await issued.json()) as { difficulty: number }).difficulty).toBe(5);

    const ws = new WebSocket(`ws://${host}/_g/ws`, ["girici.v1"], { headers: { origin: `http://${host}` } });
    const status = await new Promise<number>((resolve, reject) => {
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.once("open", () => reject(new Error("upgraded without a visitor cookie")));
      ws.once("error", reject);
    });
    expect(status).toBe(403);
  }, 15_000);
});
