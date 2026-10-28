#!/usr/bin/env node
// Reset the admin password to a fresh random one and print it.
// Usage: node ./reset-admin-password.js   (in Docker: docker compose exec girici node reset-admin-password.js)
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

let AuthStore, openDb, defaultDataDir;
try {
  ({ AuthStore } = await import("./packages/server/dist/auth/store.js"));
  ({ openDb } = await import("./packages/server/dist/db/open.js"));
  ({ defaultDataDir } = await import("./packages/server/dist/paths.js"));
} catch {
  console.error("Server build not found. Run: npm run build -w @girici/server");
  process.exit(1);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 32 unbiased characters from a 62-symbol alphabet (~190 bits). */
function generatePassword(length = 32) {
  const ceiling = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= ceiling) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

const envSecret = process.env.GIRICI_SESSION_SECRET?.trim() || undefined;
const dataDir = process.env.GIRICI_DATA_DIR?.trim() || defaultDataDir;
mkdirSync(dataDir, { recursive: true });
const store = new AuthStore(openDb(join(dataDir, "girici.db")), envSecret);

const admin = store.admin();
if (!admin) {
  console.error(`No admin found in ${join(dataDir, "girici.db")}. Open the app and finish setup first.`);
  store.close();
  process.exit(1);
}

const password = generatePassword();
store.changePassword(admin.id, password);
store.close();

console.log();
console.log(`Password reset for admin "${admin.username}".`);
console.log();
console.log(`  New password:  ${password}`);
console.log();
console.log(
  envSecret
    ? "Sign in with it on the login page."
    : "All other sessions have been signed out. Sign in with it on the login page.",
);
