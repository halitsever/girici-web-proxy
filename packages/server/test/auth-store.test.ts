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
