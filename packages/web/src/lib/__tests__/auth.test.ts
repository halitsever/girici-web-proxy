import { afterEach, describe, expect, it, vi } from "vitest";
import { setInstanceSwitch, setPublicAccess, setSealAddresses, updateAccount } from "../auth";

afterEach(() => vi.unstubAllGlobals());

describe("admin writes", () => {
  it("tells the admin how to recover from a wrong current password", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
    await expect(updateAccount({ name: "A", email: "a@a.a", currentPassword: "x" })).rejects.toThrow(
      "The current password is wrong. Forgot it? Run node reset-admin-password.js on the server.",
    );
    await expect(setPublicAccess(true, "x")).rejects.toThrow("Forgot it?");
    await expect(setSealAddresses(true, "x")).rejects.toThrow("Forgot it?");
  });

  it("turns address encryption on for everyone with the current password", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return Response.json({ sealAddresses: true });
    });
    await expect(setSealAddresses(true, "pw")).resolves.toBe(true);
    expect(sent).toEqual([{ sealAddresses: true, currentPassword: "pw" }]);
  });

  it("changes an instance switch with the current password", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const settings = {
      public: true,
      sealAddresses: false,
      blockedHosts: [],
      envBlockedHosts: [],
      deepLinkWarning: true,
      proofOfWork: true,
    };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return Response.json(settings);
    });
    await expect(setInstanceSwitch("proofOfWork", true, "pw")).resolves.toEqual(settings);
    expect(sent).toEqual([{ url: "/_g/admin/settings", body: { proofOfWork: true, currentPassword: "pw" } }]);
    vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
    await expect(setInstanceSwitch("deepLinkWarning", false, "x")).rejects.toThrow("Forgot it?");
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    await expect(setInstanceSwitch("deepLinkWarning", false, "x")).rejects.toThrow("Could not change the setting.");
  });
});
