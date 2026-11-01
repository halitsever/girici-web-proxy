import { expect, GATES, INSTANCE, QUOTA, signIn, test } from "./support/test.ts";

test("the instance server runs with its own seeded admin", async ({ request }) => {
  const state = await (await request.get(`${INSTANCE}/_g/auth/state`)).json();
  expect(state).toMatchObject({ setup: false, public: true, authed: false });
});

test("each fixture server runs with its seeded instance switches", async ({ request }) => {
  for (const [base, warning] of [
    ["http://127.0.0.1:41000", false],
    [INSTANCE, true],
    [GATES, false],
    [QUOTA, false],
  ] as const) {
    const state = await (await request.get(`${base}/_g/auth/state`)).json();
    expect(state, base).toMatchObject({ setup: false, public: true, deepLinkWarning: warning });
  }
});

test("the admin sees the warning and browser check switches as the server has them", async ({ page }) => {
  await signIn(page, GATES);
  await page.goto(`${GATES}/settings`);
  await expect(page.getByRole("switch", { name: "Warn before shared links" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Browser check for visitors" })).toBeChecked();
});
