import { afterEach, describe, expect, it, vi } from "vitest";
import { setPublicAccess, updateAccount } from "../auth";

afterEach(() => vi.unstubAllGlobals());

describe("admin writes", () => {
  it("tells the admin how to recover from a wrong current password", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
    await expect(updateAccount({ name: "A", email: "a@a.a", currentPassword: "x" })).rejects.toThrow(
      "The current password is wrong. Forgot it? Run node reset-admin-password.js on the server.",
    );
    await expect(setPublicAccess(true, "x")).rejects.toThrow("Forgot it?");
  });
});
