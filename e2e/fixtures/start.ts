import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AuthStore } from "../../packages/server/src/auth/store.ts";
import { BrandStore } from "../../packages/server/src/brand/store.ts";
import { openDb } from "../../packages/server/src/db/open.ts";
import { startTrapProxy } from "../trap-proxy.ts";
import { CERT_PATH, fixtureCert, HTTPS_HOSTS } from "./cert.ts";
import { handleFixture } from "./sites.ts";
import { GATES_PORT, METRICS_TOKEN, QUOTA_PORT } from "./servers.ts";

const ROOT = join(import.meta.dirname, "..", "..");

const SEEDED_BRAND_NAME = "Kütüphane Ağı";
// The script proves the logo is served inert: it must never run, whatever opens it.
const SEEDED_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2563eb"/>' +
    '<script>document.title="ran"</script></svg>',
);

interface SeedOptions {
  brand?: boolean;
  deepLinkWarning?: boolean;
  proofOfWork?: boolean;
}

/** An admin and public access, so the auth gate does not block the proxy tests. */
function seedDataDir(options: SeedOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "girici-e2e-"));
  const seed = new AuthStore(openDb(join(dir, "girici.db")));
  seed.createAdmin({ username: "e2e", name: "E2E", email: "e2e@test.local", password: "e2e-password" });
  seed.setPublicAccess(true);
  if (options.deepLinkWarning !== undefined) seed.setDeepLinkWarning(options.deepLinkWarning);
  if (options.proofOfWork !== undefined) seed.setProofOfWork(options.proofOfWork);
  if (options.brand) {
    new BrandStore(join(dir, "brand"), seed).update({
      name: SEEDED_BRAND_NAME,
      logo: { bytes: SEEDED_LOGO, type: "image/svg+xml" },
    });
  }
  seed.close();
  return dir;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

const cert = await fixtureCert();
// One socket that sends a binary frame, so pages can check the type it reaches them as.
const sockets = new WebSocketServer({ noServer: true });
const secure = createSecureServer(cert, handleFixture);
secure.on("upgrade", (req, socket, head) => {
  if (req.url !== "/binary-socket") {
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) => ws.send(Buffer.from([1, 2, 3])));
});
await listen(secure, 41443);
await listen(createServer(handleFixture), 41080);
await startTrapProxy();

const upstreams = Object.fromEntries([
  ...HTTPS_HOSTS.map((host) => [host, "127.0.0.1:41443"]),
  ["site-c.test", "127.0.0.1:41080"],
]);
function spawnGirici(port: number, dataDir: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, [join(ROOT, "packages/server/src/index.ts")], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      GIRICI_TEST_CA: CERT_PATH,
      GIRICI_TEST_UPSTREAMS: JSON.stringify(upstreams),
      GIRICI_DATA_DIR: dataDir,
      GIRICI_METRICS_TOKEN: METRICS_TOKEN,
      ...env,
    },
  });
}

async function waitHealthy(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server on port ${port} did not become healthy`);
}

const children: ChildProcess[] = [];

function start(port: number, seed: SeedOptions, env?: Record<string, string>): void {
  const child = spawnGirici(port, seedDataDir(seed), env);
  children.push(child);
  // One server down fails the run instead of leaving the others to answer for it.
  child.on("exit", (code) => process.exit(code ?? 1));
}

process.on("exit", () => {
  for (const child of children) child.kill();
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}

// Instance-wide writes (brand, sealing, the warning) go to 41002, so the main server keeps its settings.
start(41002, { brand: true });
start(GATES_PORT, { deepLinkWarning: false, proofOfWork: true }, { GIRICI_POW_DIFFICULTY: "4" });
start(QUOTA_PORT, { deepLinkWarning: false }, { GIRICI_BANDWIDTH_LIMIT: "1MB" });
await Promise.all([41002, GATES_PORT, QUOTA_PORT].map(waitHealthy));
// Playwright waits on this one, so it starts last. Direct /~/ loads in the specs need the warning off.
start(41000, { deepLinkWarning: false });
