import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

/** Open the SQLite database and migrate the schema in place. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
