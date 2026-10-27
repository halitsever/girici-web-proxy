import type { Realm } from "./url-context.ts";

/** Permission prompts would appear under our origin, not the real site, so notifications and push are refused outright. */
export function installPermissions(win: Realm): void {
  const Notification = (win as unknown as { Notification?: unknown }).Notification;
  if (typeof Notification === "function") {
    const blocked = function () {
      // Constructing one shows nothing; scripts that check permission see it denied.
    } as unknown as { permission: string; requestPermission: () => Promise<string> };
    Object.defineProperty(blocked, "permission", { value: "denied" });
    blocked.requestPermission = () => Promise.resolve("denied");
    (win as unknown as Record<string, unknown>).Notification = blocked;
  }

  const permissions = win.navigator?.permissions;
  if (permissions) {
    const nativeQuery = permissions.query.bind(permissions);
    permissions.query = (descriptor: { name: string }) => {
      if (descriptor && (descriptor.name === "notifications" || descriptor.name === "push")) {
        return Promise.resolve({ state: "denied", name: descriptor.name } as unknown as PermissionStatus);
      }
      return nativeQuery(descriptor as PermissionDescriptor);
    };
  }
}
