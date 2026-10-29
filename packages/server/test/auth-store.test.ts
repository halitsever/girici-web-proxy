import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/open.ts";
import { AuthStore } from "../src/auth/store.ts";

function store(): AuthStore {
  return new AuthStore(openDb(":memory:"));
}

const admin = { username: "halit", name: "Halit", email: "h@example.com", password: "pw-123456" };

describe("AuthStore admin", () => {
  it("starts with no admin and creates one", () => {
    const s = store();
    expect(s.hasAdmin()).toBe(false);
    const info = s.createAdmin(admin);
    expect(info).toMatchObject({ username: "halit", name: "Halit", email: "h@example.com" });
    expect(s.hasAdmin()).toBe(true);
    expect(s.admin()?.username).toBe("halit");
  });

  it("refuses a second admin", () => {
    const s = store();
    s.createAdmin(admin);
    expect(() => s.createAdmin({ ...admin, username: "other" })).toThrow();
  });

  it("verifies login and rejects wrong credentials", () => {
    const s = store();
    s.createAdmin(admin);
    expect(s.verifyLogin("halit", "pw-123456")?.username).toBe("halit");
    expect(s.verifyLogin("halit", "nope")).toBeNull();
    expect(s.verifyLogin("someoneelse", "pw-123456")).toBeNull();
  });

  it("updates profile and rotates the secret on password change", () => {
    const s = store();
    const info = s.createAdmin(admin);
    s.updateProfile(info.id, "Halit S", "new@example.com");
    expect(s.admin()).toMatchObject({ name: "Halit S", email: "new@example.com" });
    const before = s.sessionSecret();
    s.changePassword(info.id, "brand-new-pw");
    expect(s.sessionSecret()).not.toBe(before);
    expect(s.verifyLogin("halit", "brand-new-pw")?.id).toBe(info.id);
  });
});

describe("AuthStore settings", () => {
  it("keeps a stable session secret and rotates on demand", () => {
    const s = store();
    const secret = s.sessionSecret();
    expect(secret).toHaveLength(64);
    expect(s.sessionSecret()).toBe(secret);
    expect(s.rotateSessionSecret()).not.toBe(secret);
  });

  it("defaults public access off and toggles it", () => {
    const s = store();
    expect(s.publicAccess()).toBe(false);
    s.setPublicAccess(true);
    expect(s.publicAccess()).toBe(true);
    s.setPublicAccess(false);
    expect(s.publicAccess()).toBe(false);
  });
});

describe("AuthStore blocked hosts", () => {
  it("stores the blocked host list and reads a corrupt value as empty", () => {
    const db = openDb(":memory:");
    const s = new AuthStore(db);
    s.setBlockedHosts(["a.com", "b.com"]);
    expect(s.blockedHosts()).toEqual(["a.com", "b.com"]);
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("{", "blocked_hosts");
    expect(s.blockedHosts()).toEqual([]);
  });
});

describe("AuthStore sessions", () => {
  it("revokes sessions on a password change even with a fixed secret", () => {
    const s = new AuthStore(openDb(":memory:"), "fixed-secret-shared-by-every-replica-0000");
    const info = s.createAdmin(admin);
    expect(s.sessionsValidAfter()).toBe(0);
    s.revokeSessions(5_000);
    expect(s.sessionsValidAfter()).toBe(5_000);
    s.changePassword(info.id, "another-pw-1");
    expect(s.sessionsValidAfter()).toBeGreaterThan(5_000);
  });

  it("checks an admin's current password", () => {
    const s = store();
    const info = s.createAdmin(admin);
    expect(s.checkPassword(info.id, admin.password)).toBe(true);
    expect(s.checkPassword(info.id, "wrong-pw-123")).toBe(false);
    expect(s.checkPassword(info.id + 1, admin.password)).toBe(false);
  });
});
