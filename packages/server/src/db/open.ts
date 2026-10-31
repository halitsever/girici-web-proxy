import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema.ts";

const BUSY_TIMEOUT_MS = 5000;

/** Open the SQLite database and bring its schema up to date. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    // The reset tool writes while the server runs; WAL keeps readers going and the timeout waits out the lock.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA journal_mode = WAL");
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  if (userVersion(db) === MIGRATIONS.length) return;
  // IMMEDIATE takes the write lock first, so two processes opening an old file cannot both migrate it.
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = userVersion(db);
    if (version > MIGRATIONS.length) {
      throw new Error(
        `The database is at schema version ${version}, written by a newer version of Girici; ` +
          `this one knows up to ${MIGRATIONS.length}. Run the newer version or restore a backup.`,
      );
    }
    for (let next = version; next < MIGRATIONS.length; next++) db.exec(MIGRATIONS[next] ?? "");
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}
