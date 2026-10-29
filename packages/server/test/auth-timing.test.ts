import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../src/auth/password.ts";
import { AuthStore } from "../src/auth/store.ts";
import { openDb } from "../src/db/open.ts";

vi.mock("../src/auth/password.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/auth/password.ts")>();
  return { ...real, verifyPassword: vi.fn(real.verifyPassword) };
});

describe("AuthStore login timing", () => {
  it("runs scrypt for an unknown username too", () => {
    const store = new AuthStore(openDb(":memory:"));
    store.createAdmin({ username: "halit", name: "Halit", email: "h@h.h", password: "pw-123456" });
    vi.mocked(verifyPassword).mockClear();
    expect(store.verifyLogin("nobody", "x-123456")).toBeNull();
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });
});
