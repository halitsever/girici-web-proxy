import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { join } from "node:path";
import { startTrapProxy } from "../trap-proxy.ts";
import { CERT_PATH, fixtureCert, HTTPS_HOSTS } from "./cert.ts";
import { handleFixture } from "./sites.ts";

const ROOT = join(import.meta.dirname, "..", "..");

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

const cert = await fixtureCert();
await listen(createSecureServer(cert, handleFixture), 41443);
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
  },
});
girici.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => girici.kill(signal));
}
