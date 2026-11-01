export interface AdminInfo {
  username: string;
  name: string;
  email: string;
}

export interface AuthState {
  setup: boolean;
  authed: boolean;
  public: boolean;
  sealAddresses: boolean;
  /** True only while the instance is public and the admin left the warning on. */
  deepLinkWarning: boolean;
  /** The site domain, port included, in subdomain mode; null on a single origin. */
  siteDomain: string | null;
  admin?: AdminInfo;
}

export interface AdminSettings {
  public: boolean;
  sealAddresses: boolean;
  blockedHosts: string[];
  envBlockedHosts: string[];
  deepLinkWarning: boolean;
  proofOfWork: boolean;
}

export type InstanceSwitch = "deepLinkWarning" | "proofOfWork";

export interface SetupInput {
  setupToken: string;
  username: string;
  name: string;
  email: string;
  password: string;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };
const WRONG_PASSWORD = "The current password is wrong. Forgot it? Run node reset-admin-password.js on the server.";

let cached: Promise<AuthState> | null = null;

/** The SPA guard and the account/settings screens read their truth from here. */
export async function fetchAuthState(): Promise<AuthState> {
  const res = await fetch("/_g/auth/state", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Could not load the sign-in state.");
  return res.json() as Promise<AuthState>;
}

/** Cached for the route guard; any mutation below clears it so the next read is fresh. */
export function getAuthState(force = false): Promise<AuthState> {
  if (force || !cached) cached = fetchAuthState();
  return cached;
}

function invalidate(): void {
  cached = null;
}

export async function setupAdmin(input: SetupInput): Promise<AuthState> {
  const state = await postState("/_g/setup", input, {
    400: "Please fill every field; the password needs at least 8 characters.",
    403: "The setup code is wrong. Copy it from the latest server log.",
  });
  invalidate();
  return state;
}

export async function login(username: string, password: string): Promise<AuthState> {
  const state = await postState("/_g/login", { username, password }, { 401: "Wrong username or password." });
  invalidate();
  return state;
}

/** With everywhere set, the server also voids every other session of the admin. */
export async function logout(everywhere = false): Promise<void> {
  await fetch("/_g/logout", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ everywhere }) });
  invalidate();
}

export async function updateAccount(input: {
  name: string;
  email: string;
  password?: string;
  currentPassword: string;
}): Promise<AdminInfo> {
  const res = await fetch("/_g/account", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) });
  if (!res.ok)
    throw writeError(
      res.status,
      res.status === 400 ? "Check the name, email and password." : "Could not save the account.",
    );
  invalidate();
  return (await res.json()).admin as AdminInfo;
}

export async function setPublicAccess(on: boolean, currentPassword: string): Promise<boolean> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ publicAccess: on, currentPassword }),
  });
  if (!res.ok) throw writeError(res.status, "Could not change public access.");
  invalidate();
  return (await res.json()).public as boolean;
}

/** The instance switch seals page addresses in every visitor's browser. */
export async function setSealAddresses(on: boolean, currentPassword: string): Promise<boolean> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ sealAddresses: on, currentPassword }),
  });
  if (!res.ok) throw writeError(res.status, "Could not change address encryption.");
  invalidate();
  return (await res.json()).sealAddresses as boolean;
}

export async function setInstanceSwitch(
  name: InstanceSwitch,
  on: boolean,
  currentPassword: string,
): Promise<AdminSettings> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ [name]: on, currentPassword }),
  });
  if (!res.ok) throw writeError(res.status, "Could not change the setting.");
  invalidate();
  return res.json() as Promise<AdminSettings>;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await fetch("/_g/admin/settings", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Could not load the admin settings.");
  return res.json() as Promise<AdminSettings>;
}

export async function saveBlockedHosts(hosts: string[], currentPassword: string): Promise<AdminSettings> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ blockedHosts: hosts, currentPassword }),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { invalid?: string[] };
    if (body.invalid?.length) throw new Error(`These entries are not valid sites: ${body.invalid.join(", ")}`);
  }
  if (!res.ok) throw writeError(res.status, "Could not save blocked sites.");
  return res.json() as Promise<AdminSettings>;
}

/** Account and admin writes share these answers: 403 is a wrong current password, 429 too many tries. */
export function writeError(status: number, fallback: string): Error {
  if (status === 403) return new Error(WRONG_PASSWORD);
  if (status === 429) return new Error("Too many attempts. Wait a minute and try again.");
  return new Error(fallback);
}

async function postState(path: string, body: unknown, messages: Record<number, string>): Promise<AuthState> {
  const res = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(messages[res.status] ?? "Something went wrong. Please try again.");
  return res.json() as Promise<AuthState>;
}
