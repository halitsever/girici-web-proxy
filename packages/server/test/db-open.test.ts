import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";
import { MIGRATIONS } from "../src/db/schema.ts";

/** The schema as releases before user_version created it. */
const UNVERSIONED_SCHEMA = `
CREATE TABLE admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
`;

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "girici-db-")), "girici.db");
}

function pragma(db: DatabaseSync, name: string): unknown {
  return Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
}

describe("openDb", () => {
  it("uses WAL with a busy timeout so the reset tool and the server can share the file", () => {
    const db = openDb(dbPath());
    expect(pragma(db, "journal_mode")).toBe("wal");
    expect(pragma(db, "busy_timeout")).toBe(5000);
    db.close();
  });

  it("creates a new database at the latest version", () => {
    const db = openDb(dbPath());
    expect(pragma(db, "user_version")).toBe(MIGRATIONS.length);
    expect(new AuthStore(db).hasAdmin()).toBe(false);
    db.close();
  });

  it("takes an unversioned database as version 1 and keeps its data", () => {
    const path = dbPath();
    const old = new DatabaseSync(path);
    old.exec(UNVERSIONED_SCHEMA);
    old.close();
    const before = new AuthStore(new DatabaseSync(path));
    before.createAdmin({ username: "admin", name: "A", email: "a@a.a", password: "pw-123456" });
    before.setPublicAccess(true);
    before.close();

    const db = openDb(path);
    expect(pragma(db, "user_version")).toBe(MIGRATIONS.length);
    const store = new AuthStore(db);
    expect(store.verifyLogin("admin", "pw-123456")?.username).toBe("admin");
    expect(store.publicAccess()).toBe(true);
    store.close();
  });

  it("brings a version 1 database to version 2 with the traffic table", () => {
    const path = dbPath();
    const old = new DatabaseSync(path);
    old.exec(MIGRATIONS[0] ?? "");
    old.exec("PRAGMA user_version = 1");
    new AuthStore(old).createAdmin({ username: "admin", name: "A", email: "a@a.a", password: "pw-123456" });
    old.close();

    const db = openDb(path);
    expect(pragma(db, "user_version")).toBe(2);
    expect(new AuthStore(db).verifyLogin("admin", "pw-123456")?.username).toBe("admin");
    db.prepare("INSERT INTO traffic_daily (day, requests) VALUES (?, ?)").run("2026-11-01", 4);
    expect(db.prepare("SELECT requests, bytes_down FROM traffic_daily").get()).toEqual({
      requests: 4,
      bytes_down: 0,
    });
    db.close();
  });

  it("opens the same file again without migrating twice", () => {
    const path = dbPath();
    openDb(path).close();
    const db = openDb(path);
    expect(pragma(db, "user_version")).toBe(MIGRATIONS.length);
    db.close();
  });

  it("refuses a database written by a newer Girici", () => {
    const path = dbPath();
    const future = new DatabaseSync(path);
    future.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    future.close();
    expect(() => openDb(path)).toThrow(/newer version of Girici/);
  });
});
