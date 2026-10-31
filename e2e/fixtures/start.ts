import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AuthStore } from "../../packages/server/src/auth/store.ts";
import { openDb } from "../../packages/server/src/db/open.ts";
import { startTrapProxy } from "../trap-proxy.ts";
import { CERT_PATH, fixtureCert, HTTPS_HOSTS } from "./cert.ts";
import { handleFixture } from "./sites.ts";

const ROOT = join(import.meta.dirname, "..", "..");

// Seed an admin and open public access so the auth gate does not block the proxy tests.
const DATA_DIR = mkdtempSync(join(tmpdir(), "girici-e2e-"));
const seed = new AuthStore(openDb(join(DATA_DIR, "girici.db")));
seed.createAdmin({ username: "e2e", name: "E2E", email: "e2e@test.local", password: "e2e-password" });
seed.setPublicAccess(true);
seed.close();

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
const girici = spawn(process.execPath, [join(ROOT, "packages/server/src/index.ts")], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: "41000",
    HOST: "127.0.0.1",
    LOG_LEVEL: "warn",
    GIRICI_TEST_CA: CERT_PATH,
    GIRICI_TEST_UPSTREAMS: JSON.stringify(upstreams),
    GIRICI_DATA_DIR: DATA_DIR,
  },
});
girici.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => girici.kill(signal));
}
