import { describe, expect, it } from "vitest";
import { installPermissions } from "../src/client/permissions.ts";
import type { Realm } from "../src/client/url-context.ts";

describe("installPermissions", () => {
  it("returns a denied status that tolerates change listeners", async () => {
    const win = {
      navigator: { permissions: { query: () => Promise.resolve({ state: "granted" }) } },
    } as unknown as Realm;
    installPermissions(win);
    const status = (await win.navigator.permissions.query({ name: "notifications" })) as unknown as {
      state: string;
      addEventListener: (type: string, listener: () => void) => void;
    };
    expect(status.state).toBe("denied");
    expect(() => status.addEventListener("change", () => {})).not.toThrow();
  });
});
