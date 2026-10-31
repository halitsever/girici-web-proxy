import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./password.ts";

interface AdminRow {
  id: number;
  username: string;
  name: string;
  email: string;
  pw_hash: string;
  pw_salt: string;
  created_at: number;
}

export interface AdminInfo {
  id: number;
  username: string;
  name: string;
  email: string;
}

export interface NewAdmin {
  username: string;
  name: string;
  email: string;
  password: string;
}

let dummy: { hash: string; salt: string } | null = null;

/** A throwaway hash to check against when there is no real one, computed on first use. */
function dummyHash(): { hash: string; salt: string } {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}

/** Admin credentials and operator settings backed by SQLite. */
export class AuthStore {
  readonly #db: DatabaseSync;
  readonly #secretOverride: string | undefined;

  constructor(db: DatabaseSync, secretOverride?: string) {
    this.#db = db;
    this.#secretOverride = secretOverride;
  }

  close(): void {
    this.#db.close();
  }

  hasAdmin(): boolean {
    return this.#adminRow() !== null;
  }

  admin(): AdminInfo | null {
    const row = this.#adminRow();
    return row ? { id: row.id, username: row.username, name: row.name, email: row.email } : null;
  }

  createAdmin(input: NewAdmin): AdminInfo {
    if (this.hasAdmin()) throw new Error("admin already exists");
    const { hash, salt } = hashPassword(input.password);
    const result = this.#db
      .prepare("INSERT INTO admins (username, name, email, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.username, input.name, input.email, hash, salt, Date.now());
    return { id: Number(result.lastInsertRowid), username: input.username, name: input.name, email: input.email };
  }

  verifyLogin(username: string, password: string): AdminInfo | null {
    const row = this.#adminRow();
    if (!row || row.username !== username) {
      // An unknown name still pays for one scrypt, so the response time does not reveal the username.
      const dummy = dummyHash();
      verifyPassword(password, dummy.hash, dummy.salt);
      return null;
    }
    if (!verifyPassword(password, row.pw_hash, row.pw_salt)) return null;
    return { id: row.id, username: row.username, name: row.name, email: row.email };
  }

  /** Confirms a signed-in admin's password before a sensitive change; an unknown id still runs scrypt. */
  checkPassword(id: number, password: string): boolean {
    const row = this.#adminRow();
    if (!row || row.id !== id) {
      const dummy = dummyHash();
      verifyPassword(password, dummy.hash, dummy.salt);
      return false;
    }
    return verifyPassword(password, row.pw_hash, row.pw_salt);
  }

  updateProfile(id: number, name: string, email: string): void {
    this.#db.prepare("UPDATE admins SET name = ?, email = ? WHERE id = ?").run(name, email, id);
  }

  /** Logs every device out; revocation also covers a fixed GIRICI_SESSION_SECRET, which cannot rotate. */
  changePassword(id: number, password: string): void {
    const { hash, salt } = hashPassword(password);
    this.#db.prepare("UPDATE admins SET pw_hash = ?, pw_salt = ? WHERE id = ?").run(hash, salt, id);
    this.revokeSessions();
    this.rotateSessionSecret();
  }

  /** Sessions issued before this time (ms) are void. Read on every check, since the reset script writes it. */
  sessionsValidAfter(): number {
    const value = Number(this.#setting("sessions_valid_after"));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  revokeSessions(now = Date.now()): void {
    this.#setSetting("sessions_valid_after", String(now));
  }

  sessionSecret(): string {
    if (this.#secretOverride) return this.#secretOverride;
    const existing = this.#setting("session_secret");
    if (existing) return existing;
    return this.rotateSessionSecret();
  }

  /** A fixed override (shared across replicas) cannot be rotated from here. */
  rotateSessionSecret(): string {
    if (this.#secretOverride) return this.#secretOverride;
    const secret = randomBytes(32).toString("hex");
    this.#setSetting("session_secret", secret);
    return secret;
  }

  publicAccess(): boolean {
    return this.#setting("public_access") === "1";
  }

  setPublicAccess(on: boolean): void {
    this.#setSetting("public_access", on ? "1" : "0");
  }

  /** The admin's switch that seals page addresses in every visitor's browser. */
  sealAddresses(): boolean {
    return this.#setting("seal_addresses") === "1";
  }

  setSealAddresses(on: boolean): void {
    this.#setSetting("seal_addresses", on ? "1" : "0");
  }

  /** Normalized host entries the admin blocked in Settings; an unreadable value counts as none. */
  blockedHosts(): string[] {
    const raw = this.#setting("blocked_hosts");
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((host): host is string => typeof host === "string") : [];
    } catch {
      return [];
    }
  }

  setBlockedHosts(hosts: readonly string[]): void {
    this.#setSetting("blocked_hosts", JSON.stringify(hosts));
  }

  #adminRow(): AdminRow | null {
    const row = this.#db.prepare("SELECT * FROM admins ORDER BY id LIMIT 1").get() as AdminRow | undefined;
    return row ?? null;
  }

  #setting(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  #setSetting(key: string, value: string): void {
    this.#db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}
