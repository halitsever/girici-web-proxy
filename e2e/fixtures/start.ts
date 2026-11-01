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
import { PRIVATE_SITES, SITE_SECRET, SITES } from "../support/site-mode.ts";
import { startTrapProxy } from "../trap-proxy.ts";
import { CERT_PATH, fixtureCert, HTTPS_HOSTS } from "./cert.ts";
import { handleFixture } from "./sites.ts";

const ROOT = join(import.meta.dirname, "..", "..");

const SEEDED_BRAND_NAME = "Kütüphane Ağı";
// The script proves the logo is served inert: it must never run, whatever opens it.
const SEEDED_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2563eb"/>' +
    '<script>document.title="ran"</script></svg>',
);

/** An admin, and public access so the gate does not block the proxy tests, unless the server exists to test the gate. */
function seedDataDir(options: { brand?: boolean; publicAccess?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "girici-e2e-"));
  const seed = new AuthStore(openDb(join(dir, "girici.db")));
  seed.createAdmin({ username: "e2e", name: "E2E", email: "e2e@test.local", password: "e2e-password" });
  seed.setPublicAccess(options.publicAccess ?? true);
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
const children: ChildProcess[] = [];
function spawnGirici(port: number, dataDir: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, [join(ROOT, "packages/server/src/index.ts")], {
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
      ...env,
    },
  });
  // Any server that stops takes the harness down, so Playwright reports it instead of timing out.
  child.on("exit", (code) => process.exit(code ?? 1));
  children.push(child);
  return child;
}

async function waitHealthy(port: number): Promise<void> {
  // Three servers start together, which a busy CI machine can take a while over.
  const deadline = Date.now() + 30_000;
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

/** Subdomain mode, where each site runs on its own host under the root. */
function siteMode(base: string): Record<string, string> {
  return { GIRICI_SITE_DOMAIN: new URL(base).host, GIRICI_SITE_SECRET: SITE_SECRET };
}

// Instance-wide writes (brand, sealing) go to 41002, so the main server keeps its settings. Playwright waits for
// 41000 only, so it starts last.
spawnGirici(41002, seedDataDir({ brand: true }));
spawnGirici(41005, seedDataDir(), siteMode(SITES));
spawnGirici(41006, seedDataDir({ publicAccess: false }), siteMode(PRIVATE_SITES));
await Promise.all([waitHealthy(41002), waitHealthy(41005), waitHealthy(41006)]);
spawnGirici(41000, seedDataDir());
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
