/**
 * Migration n brings the database to user_version n + 1. Append only. Migration 1 uses IF NOT EXISTS because
 * databases from before user_version already hold its tables and must come out at version 1 untouched.
 */
export const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`,
  `
CREATE TABLE traffic_daily (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  sockets INTEGER NOT NULL DEFAULT 0,
  bytes_down INTEGER NOT NULL DEFAULT 0,
  bytes_up INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0
) STRICT;
`,
];
