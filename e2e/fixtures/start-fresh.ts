import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

// A second server with an empty database, so setup can be tested without touching the seeded one.
const girici = spawn(process.execPath, [join(ROOT, "packages/server/src/index.ts")], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "41001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "warn",
    GIRICI_DATA_DIR: mkdtempSync(join(tmpdir(), "girici-e2e-fresh-")),
    GIRICI_SETUP_TOKEN: "e2e-setup-code",
  },
});
girici.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => girici.kill(signal));
}
