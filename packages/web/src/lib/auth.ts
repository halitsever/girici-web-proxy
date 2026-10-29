export interface AdminInfo {
  username: string;
  name: string;
  email: string;
}

export interface AuthState {
  setup: boolean;
  authed: boolean;
  public: boolean;
  admin?: AdminInfo;
}

export interface AdminSettings {
  public: boolean;
  blockedHosts: string[];
  envBlockedHosts: string[];
}

export interface SetupInput {
  username: string;
  name: string;
  email: string;
  password: string;
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

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
  });
  invalidate();
  return state;
}

export async function login(username: string, password: string): Promise<AuthState> {
  const state = await postState("/_g/login", { username, password }, { 401: "Wrong username or password." });
  invalidate();
  return state;
}

export async function logout(): Promise<void> {
  await fetch("/_g/logout", { method: "POST", headers: JSON_HEADERS });
  invalidate();
}

export async function updateAccount(input: { name: string; email: string; password?: string }): Promise<AdminInfo> {
  const res = await fetch("/_g/account", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) });
  if (!res.ok)
    throw new Error(res.status === 400 ? "Check the name, email and password." : "Could not save the account.");
  invalidate();
  return (await res.json()).admin as AdminInfo;
}

export async function setPublicAccess(on: boolean): Promise<boolean> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ publicAccess: on }),
  });
  if (!res.ok) throw new Error("Could not change public access.");
  invalidate();
  return (await res.json()).public as boolean;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const res = await fetch("/_g/admin/settings", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Could not load the admin settings.");
  return res.json() as Promise<AdminSettings>;
}

export async function saveBlockedHosts(hosts: string[]): Promise<AdminSettings> {
  const res = await fetch("/_g/admin/settings", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ blockedHosts: hosts }),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { invalid?: string[] };
    if (body.invalid?.length) throw new Error(`These entries are not valid sites: ${body.invalid.join(", ")}`);
  }
  if (!res.ok) throw new Error("Could not save blocked sites.");
  return res.json() as Promise<AdminSettings>;
}

async function postState(path: string, body: unknown, messages: Record<number, string>): Promise<AuthState> {
  const res = await fetch(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(messages[res.status] ?? "Something went wrong. Please try again.");
  return res.json() as Promise<AuthState>;
}
